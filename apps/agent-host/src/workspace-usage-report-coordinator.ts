import type {
  AgentCommand,
  CommandResults,
  WorkspaceProtocolContext
} from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";
import type { WorkspaceCommandRouter } from "./workspace-command-router.js";

const DEFAULT_MAX_ACTIVE = 4;
const DEFAULT_MAX_PENDING_JOBS = 32;
const DEFAULT_MAX_PENDING_WAITERS = 128;

type UsageReport = CommandResults["workspace.usage.report"];
type UsageCommand = AgentCommand<"workspace.usage.report">;

export interface WorkspaceUsageReportCoordinatorOptions {
  maxActive?: number;
  maxPendingJobs?: number;
  maxPendingWaiters?: number;
}

interface UsageJob {
  readonly key: string;
  readonly context: WorkspaceProtocolContext;
  readonly command: UsageCommand;
  readonly controller: AbortController;
  readonly waiters: Set<UsageWaiter>;
  started: boolean;
}

interface UsageWaiter {
  readonly resolve: (value: UsageReport) => void;
  readonly reject: (error: unknown) => void;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}

export class WorkspaceUsageReportCoordinator {
  private readonly jobs = new Map<string, UsageJob>();
  private readonly queue: UsageJob[] = [];
  private readonly activeWorkspaces = new Set<string>();
  private readonly activeJobs = new Set<Promise<void>>();
  private readonly maxActive: number;
  private readonly maxPendingJobs: number;
  private readonly maxPendingWaiters: number;
  private active = 0;
  private waiterCount = 0;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly workspaceCommands: Pick<WorkspaceCommandRouter, "usageReport">,
    options: WorkspaceUsageReportCoordinatorOptions = {}
  ) {
    this.maxActive = positiveLimit(options.maxActive, DEFAULT_MAX_ACTIVE);
    this.maxPendingJobs = positiveLimit(options.maxPendingJobs, DEFAULT_MAX_PENDING_JOBS);
    this.maxPendingWaiters = positiveLimit(
      options.maxPendingWaiters,
      DEFAULT_MAX_PENDING_WAITERS
    );
  }

  request(
    context: WorkspaceProtocolContext,
    command: UsageCommand,
    signal: AbortSignal
  ): Promise<UsageReport> {
    if (this.shuttingDown) return Promise.reject(connectionClosed("shutdown"));
    if (signal.aborted) return Promise.reject(connectionClosed("caller-cancelled"));
    if (this.waiterCount >= this.maxPendingWaiters) {
      return Promise.reject(resourceLimit(
        "The Workspace usage report waiter limit has been reached.",
        { maxPendingWaiters: this.maxPendingWaiters }
      ));
    }

    const key = usageJobKey(context.workspaceId, command.payload.window);
    let job = this.jobs.get(key);
    if (!job) {
      this.supersedeWorkspaceJobs(context.workspaceId);
      if (this.jobs.size >= this.maxPendingJobs) {
        return Promise.reject(resourceLimit(
          "The Workspace usage report queue is full.",
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
        "Workspace usage report shutdown deadline must be between 1 and 10000 milliseconds."
      ));
    }
    this.shuttingDown = true;
    for (const job of this.jobs.values()) {
      job.controller.abort();
      this.rejectWaiters(job, connectionClosed("shutdown"));
    }
    this.jobs.clear();
    this.queue.splice(0);
    const activeJobs = [...this.activeJobs];
    this.shutdownPromise = activeJobs.length === 0
      ? Promise.resolve()
      : waitForActiveJobs(activeJobs, deadlineMs);
    return this.shutdownPromise;
  }

  private supersedeWorkspaceJobs(workspaceId: string): void {
    for (const job of this.jobs.values()) {
      if (job.context.workspaceId !== workspaceId) continue;
      this.jobs.delete(job.key);
      job.controller.abort();
      this.rejectWaiters(job, connectionClosed("superseded"));
      if (!job.started) this.removeQueuedJob(job);
    }
  }

  private addWaiter(job: UsageJob, signal: AbortSignal): Promise<UsageReport> {
    return new Promise<UsageReport>((resolve, reject) => {
      const waiter: UsageWaiter = {
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

  private cancelWaiter(job: UsageJob, waiter: UsageWaiter): void {
    if (!job.waiters.delete(waiter)) return;
    this.releaseWaiter(waiter);
    waiter.reject(connectionClosed("caller-cancelled"));
    if (job.waiters.size > 0) return;
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    job.controller.abort();
    if (!job.started) {
      this.removeQueuedJob(job);
      this.pump();
    }
  }

  private pump(): void {
    while (!this.shuttingDown && this.active < this.maxActive) {
      const index = this.queue.findIndex((job) => (
        !this.activeWorkspaces.has(job.context.workspaceId)
      ));
      if (index < 0) return;
      const [job] = this.queue.splice(index, 1);
      if (!job || job.waiters.size === 0 || this.jobs.get(job.key) !== job) continue;
      this.start(job);
    }
  }

  private start(job: UsageJob): void {
    job.started = true;
    this.active += 1;
    this.activeWorkspaces.add(job.context.workspaceId);
    const activeJob = Promise.resolve().then(() => this.workspaceCommands.usageReport(
      job.context,
      job.command,
      job.controller.signal
    )).then(
      (result) => this.settle(job, { result }),
      (error: unknown) => this.settle(job, { error })
    );
    this.activeJobs.add(activeJob);
    void activeJob.finally(() => this.activeJobs.delete(activeJob)).catch(() => undefined);
  }

  private settle(
    job: UsageJob,
    outcome: { result: UsageReport } | { error: unknown }
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

  private rejectWaiters(job: UsageJob, error: HostCommandError): void {
    for (const waiter of job.waiters) {
      job.waiters.delete(waiter);
      this.releaseWaiter(waiter);
      waiter.reject(error);
    }
  }

  private releaseWaiter(waiter: UsageWaiter): void {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    this.waiterCount = Math.max(0, this.waiterCount - 1);
  }

  private releaseActive(job: UsageJob): void {
    if (!job.started) return;
    job.started = false;
    this.active = Math.max(0, this.active - 1);
    this.activeWorkspaces.delete(job.context.workspaceId);
  }

  private removeQueuedJob(job: UsageJob): void {
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
  }
}

function usageJobKey(workspaceId: string, window: UsageCommand["payload"]["window"]): string {
  return `${workspaceId}\0${window}`;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isInteger(value) || value <= 0 ? fallback : value;
}

function connectionClosed(
  reason: "caller-cancelled" | "shutdown" | "superseded"
): HostCommandError {
  const message = reason === "shutdown"
    ? "The Pi runtime service is shutting down."
    : reason === "superseded"
      ? "The Workspace usage report was replaced by a newer window."
      : "The Renderer no longer needs this Workspace usage report.";
  return new HostCommandError("CONNECTION_CLOSED", message, true, { reason });
}

function resourceLimit(message: string, details: Record<string, number>): HostCommandError {
  return new HostCommandError("RESOURCE_LIMIT_EXCEEDED", message, true, details);
}

async function waitForActiveJobs(activeJobs: Promise<void>[], deadlineMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new HostCommandError(
      "RUNTIME_POISONED",
      "Workspace usage reports did not settle before shutdown.",
      false,
      { workspaceUsageReportShutdown: false }
    )), deadlineMs);
    timer.unref?.();
  });
  try {
    await Promise.race([Promise.allSettled(activeJobs), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
