import type {
  AgentCommand,
  CommandResults,
  WorkspaceProtocolContext
} from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";
import type { WorkspaceCommandRouter } from "./workspace-command-router.js";

const DEFAULT_MAX_ACTIVE = 4;
const DEFAULT_MAX_ACTIVE_PER_WORKSPACE = 1;
const DEFAULT_MAX_PENDING_JOBS = 64;
const DEFAULT_MAX_PENDING_WAITERS = 256;

type Resolution = CommandResults["session.creation.resolve"];
type ResolveCommand = AgentCommand<"session.creation.resolve">;

export interface SessionCreationResolutionCoordinatorOptions {
  maxActive?: number;
  maxActivePerWorkspace?: number;
  maxPendingJobs?: number;
  maxPendingWaiters?: number;
}

interface ResolutionJob {
  readonly key: string;
  readonly context: WorkspaceProtocolContext;
  readonly command: ResolveCommand;
  readonly controller: AbortController;
  readonly waiters: Set<ResolutionWaiter>;
  started: boolean;
}

interface ResolutionWaiter {
  readonly resolve: (value: Resolution) => void;
  readonly reject: (error: unknown) => void;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}

export class SessionCreationResolutionCoordinator {
  private readonly jobs = new Map<string, ResolutionJob>();
  private readonly queue: ResolutionJob[] = [];
  private readonly activeByWorkspace = new Map<string, number>();
  private readonly activeJobs = new Set<Promise<void>>();
  private readonly maxActive: number;
  private readonly maxActivePerWorkspace: number;
  private readonly maxPendingJobs: number;
  private readonly maxPendingWaiters: number;
  private active = 0;
  private waiterCount = 0;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly workspaceCommands: Pick<WorkspaceCommandRouter, "resolveSessionCreation">,
    options: SessionCreationResolutionCoordinatorOptions = {}
  ) {
    this.maxActive = positiveLimit(options.maxActive, DEFAULT_MAX_ACTIVE);
    this.maxActivePerWorkspace = positiveLimit(
      options.maxActivePerWorkspace,
      DEFAULT_MAX_ACTIVE_PER_WORKSPACE
    );
    this.maxPendingJobs = positiveLimit(options.maxPendingJobs, DEFAULT_MAX_PENDING_JOBS);
    this.maxPendingWaiters = positiveLimit(
      options.maxPendingWaiters,
      DEFAULT_MAX_PENDING_WAITERS
    );
  }

  resolve(
    context: WorkspaceProtocolContext,
    command: ResolveCommand,
    signal: AbortSignal
  ): Promise<Resolution> {
    if (this.shuttingDown) return Promise.reject(connectionClosed(true));
    if (signal.aborted) return Promise.reject(connectionClosed(false));
    if (this.waiterCount >= this.maxPendingWaiters) {
      return Promise.reject(resourceLimit(
        "The Session creation resolution waiter limit has been reached.",
        { maxPendingWaiters: this.maxPendingWaiters }
      ));
    }

    const key = resolutionKey(context.workspaceId, command.payload.creationId);
    let job = this.jobs.get(key);
    if (!job) {
      if (this.jobs.size >= this.maxPendingJobs) {
        return Promise.reject(resourceLimit(
          "The Session creation resolution queue is full.",
          { maxPendingJobs: this.maxPendingJobs }
        ));
      }
      job = {
        key,
        context,
        command,
        controller: new AbortController(),
        waiters: new Set(),
        started: false
      };
      this.jobs.set(key, job);
      this.queue.push(job);
    }

    const promise = this.addWaiter(job, signal);
    this.pump();
    return promise;
  }

  shutdown(deadlineMs = 1_000): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 10_000) {
      return Promise.reject(new RangeError(
        "Session creation resolution shutdown deadline must be between 1 and 10000 milliseconds."
      ));
    }
    this.shuttingDown = true;
    for (const job of this.jobs.values()) {
      job.controller.abort();
      this.rejectWaiters(job, connectionClosed(true));
    }
    this.jobs.clear();
    this.queue.splice(0);
    const activeJobs = [...this.activeJobs];
    this.shutdownPromise = activeJobs.length === 0
      ? Promise.resolve()
      : waitForActiveJobs(activeJobs, deadlineMs);
    return this.shutdownPromise;
  }

  private addWaiter(job: ResolutionJob, signal: AbortSignal): Promise<Resolution> {
    return new Promise<Resolution>((resolve, reject) => {
      const waiter: ResolutionWaiter = {
        resolve,
        reject,
        signal,
        onAbort: () => this.cancelWaiter(job, waiter)
      };
      job.waiters.add(waiter);
      this.waiterCount += 1;
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      if (signal.aborted) this.cancelWaiter(job, waiter);
    });
  }

  private cancelWaiter(job: ResolutionJob, waiter: ResolutionWaiter): void {
    if (!job.waiters.delete(waiter)) return;
    this.releaseWaiter(waiter);
    waiter.reject(connectionClosed(false));
    if (job.waiters.size > 0) return;

    if (job.started) {
      this.jobs.delete(job.key);
      job.controller.abort();
      return;
    }
    this.removeQueuedJob(job);
    this.jobs.delete(job.key);
    this.pump();
  }

  private pump(): void {
    while (!this.shuttingDown && this.active < this.maxActive) {
      const index = this.queue.findIndex((job) => (
        (this.activeByWorkspace.get(job.context.workspaceId) ?? 0)
          < this.maxActivePerWorkspace
      ));
      if (index < 0) return;
      const [job] = this.queue.splice(index, 1);
      if (!job || job.waiters.size === 0 || !this.jobs.has(job.key)) continue;
      this.start(job);
    }
  }

  private start(job: ResolutionJob): void {
    job.started = true;
    this.active += 1;
    this.activeByWorkspace.set(
      job.context.workspaceId,
      (this.activeByWorkspace.get(job.context.workspaceId) ?? 0) + 1
    );
    const activeJob = Promise.resolve().then(() => this.workspaceCommands.resolveSessionCreation(
      job.context,
      job.command,
      { signal: job.controller.signal }
    )).then(
      (result) => this.settle(job, { result }),
      (error: unknown) => this.settle(job, { error })
    );
    this.activeJobs.add(activeJob);
    void activeJob.finally(() => this.activeJobs.delete(activeJob)).catch(() => undefined);
  }

  private settle(
    job: ResolutionJob,
    outcome: { result: Resolution } | { error: unknown }
  ): void {
    this.releaseActive(job);
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    for (const waiter of job.waiters) {
      job.waiters.delete(waiter);
      this.releaseWaiter(waiter);
      if ("result" in outcome) waiter.resolve(outcome.result);
      else waiter.reject(outcome.error);
    }
    this.pump();
  }

  private rejectWaiters(job: ResolutionJob, error: HostCommandError): void {
    for (const waiter of job.waiters) {
      job.waiters.delete(waiter);
      this.releaseWaiter(waiter);
      waiter.reject(error);
    }
  }

  private releaseWaiter(waiter: ResolutionWaiter): void {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    this.waiterCount = Math.max(0, this.waiterCount - 1);
  }

  private releaseActive(job: ResolutionJob): void {
    if (!job.started) return;
    job.started = false;
    this.active = Math.max(0, this.active - 1);
    const remaining = Math.max(
      0,
      (this.activeByWorkspace.get(job.context.workspaceId) ?? 0) - 1
    );
    if (remaining === 0) this.activeByWorkspace.delete(job.context.workspaceId);
    else this.activeByWorkspace.set(job.context.workspaceId, remaining);
  }

  private removeQueuedJob(job: ResolutionJob): void {
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
  }
}

function resolutionKey(workspaceId: string, creationId: string): string {
  return `${workspaceId}\0${creationId}`;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isInteger(value) || value <= 0 ? fallback : value;
}

function connectionClosed(shuttingDown: boolean): HostCommandError {
  return new HostCommandError(
    "CONNECTION_CLOSED",
    shuttingDown
      ? "The Pi runtime service is shutting down."
      : "The Renderer connection closed before Session creation resolution completed.",
    true,
    { shuttingDown }
  );
}

function resourceLimit(message: string, details: Record<string, number>): HostCommandError {
  return new HostCommandError("RESOURCE_LIMIT_EXCEEDED", message, true, details);
}

async function waitForActiveJobs(activeJobs: Promise<void>[], deadlineMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new HostCommandError(
      "RUNTIME_POISONED",
      "Session creation resolution did not settle before shutdown.",
      false,
      { sessionCreationResolutionShutdown: false }
    )), deadlineMs);
    timer.unref?.();
  });
  try {
    await Promise.race([Promise.allSettled(activeJobs), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
