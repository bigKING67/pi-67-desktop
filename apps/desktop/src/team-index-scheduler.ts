import type { UtilityProcess } from "electron";
import type { createInstalledLocalMemory } from "./installed-local-memory.js";
import type { NativeTeamModelWorkerOptions } from "./native-team-model-worker.mjs";
import { bindSharedKnowledgeOwner, type SharedKnowledgeReceiptOwner } from "./shared-knowledge-owner.js";
import type { writeTeamIndexJob } from "./team-index-job.js";

type Preparation = ReturnType<typeof createInstalledLocalMemory>["teamPreparation"];
type Input = Omit<Parameters<typeof writeTeamIndexJob>[0], "prepared"> & { owner: SharedKnowledgeReceiptOwner };
type Job = Awaited<ReturnType<typeof writeTeamIndexJob>>;
type Permit = { cancel(): void; completion: Promise<"completed" | "cancelled"> };
type Register = (requestId: string, options: Omit<NativeTeamModelWorkerOptions, "attachModelChannel">,
  signal: AbortSignal, beforeLaunch: (signal: AbortSignal) => Promise<void>) => Permit;
type Verified = Awaited<ReturnType<Job["verifyResult"]>> & { directory: string; scopeKey: string };
interface Task {
  readonly scopeKey: string;
  readonly completion: Promise<Readonly<Verified>>;
  /** Internal Main only: exact Host reservation for this task's scope/models.
   * Register before instructing Host to start; no reservation is fabricated. */
  register(requestId: string): void;
  cancel(): void;
}

/** Owns preparation through physical completion, not publication or model grants.
 * No queue/retry: at most four tasks and one task per exact scoped owner. */
export class TeamIndexScheduler {
  private readonly entries = new Map<string, { cancel(): void; completion: Promise<Readonly<Verified>> }>();
  private stopped = false;
  private cleanupFailed = false;
  constructor(private readonly currentHost: () => UtilityProcess | undefined, private readonly registerWorker: Register) {}

  prepare(preparation: Preparation, input: Input): Promise<Readonly<Task>> {
    const host = this.currentHost(), { owner, key } = bindSharedKnowledgeOwner(input.owner);
    if (!host || this.stopped || this.cleanupFailed || input.signal.aborted || input.binding.signal.aborted
        || input.binding.scopeKey !== key || this.entries.has(key) || this.entries.size >= 4) {
      return Promise.reject(new Error("Team index preparation unavailable."));
    }
    // Snapshot caller-owned selection before any asynchronous preparation.
    const models = { embedding: { endpoint: input.models.embedding.endpoint, model: input.models.embedding.model,
      dimension: input.models.embedding.dimension }, extraction: { endpoint: input.models.extraction.endpoint, model: input.models.extraction.model } };
    const limits = { ...input.limits }, binding = input.binding, assertReadable = input.assertReadable;
    const lifetime = new AbortController(), signal = AbortSignal.any([lifetime.signal, input.signal, binding.signal]);
    const cancel = () => lifetime.abort();
    const assertCurrent = () => {
      signal.throwIfAborted(); assertReadable();
      if (this.currentHost() !== host) throw new Error("Team index Host changed.");
    };
    let resolveReady!: (task: Readonly<Task>) => void, rejectReady!: (error: unknown) => void;
    const ready = new Promise<Readonly<Task>>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    let resolvePermit!: (permit: Permit) => void, rejectPermit!: (error: Error) => void;
    const requested = new Promise<Permit>((resolve, reject) => { resolvePermit = resolve; rejectPermit = reject; });
    void requested.catch(() => undefined);
    const onAbort = () => rejectPermit(new Error("Team index task cancelled."));
    signal.addEventListener("abort", onAbort, { once: true }); host.on("exit", cancel);
    let timer = setTimeout(cancel, 60_000);
    let prepared: Awaited<ReturnType<Preparation["prepareIndexWorker"]>> | undefined;
    let job: Job | undefined, registered = false;
    // Defer work by one microtask so even synchronous cancellation observes the slot.
    const run = Promise.resolve().then(async () => {
      assertCurrent();
      prepared = await preparation.prepareIndexWorker(owner, signal); assertCurrent();
      job = await preparation.writeIndexJob({ prepared, binding, models, limits, assertReadable, signal });
      assertCurrent();
      const selected = prepared, written = job;
      clearTimeout(timer); timer = setTimeout(cancel, 5_000);
      resolveReady(Object.freeze({ scopeKey: key, completion, cancel, register: (requestId: string) => {
        assertCurrent();
        if (registered) { cancel(); throw new Error("Team index task already registered."); }
        try {
          const permit = this.registerWorker(requestId, { python: selected.runtime.python, bootstrap: selected.bootstrap,
            cwd: selected.directory, arguments: [] }, signal, async launchSignal => {
            assertCurrent();
            await selected.assertLaunchable(launchSignal);
            await written.assertSnapshotCurrent();
            launchSignal.throwIfAborted(); assertCurrent();
          });
          registered = true; clearTimeout(timer); resolvePermit(permit);
        } catch (error) { cancel(); throw error; }
      } }));
      const permit = await requested;
      // This promise belongs to this exact Main permit. Never substitute Host
      // state, a port close or an unrelated task's completion.
      const verified = await written.verifyResult(permit.completion);
      assertCurrent();
      return Object.freeze({ ...verified, directory: selected.directory, scopeKey: key });
    });
    const cleanup = async () => {
      clearTimeout(timer); signal.removeEventListener("abort", onAbort); host.off("exit", cancel);
      try {
        if (!registered && prepared) {
          // No worker permit was handed out. Exact input + empty run only.
          // Registered jobs retain staging even on failure: cleanup/publication
          // needs a separate physical-containment and storage ownership decision.
          if (job) await job.discardInput();
          await prepared.discard();
        }
      } catch {
        this.cleanupFailed = true;
        throw new Error("Team index staging cleanup could not be confirmed.");
      } finally { this.entries.delete(key); }
    };
    // Cleanup failure must prevent a successful result without hiding a throw
    // in the work's finally block. All slots settle only after cleanup finishes.
    const completion = run.then(async result => { await cleanup(); return result; },
      async (error: unknown) => { await cleanup(); throw error; });
    this.entries.set(key, { cancel, completion });
    void completion.catch(rejectReady);
    return ready;
  }

  invalidate(): void { for (const entry of this.entries.values()) entry.cancel(); }
  async shutdown(): Promise<void> {
    this.stopped = true;
    const pending = [...this.entries.values()].map(entry => entry.completion);
    this.invalidate(); await Promise.allSettled(pending);
    if (this.cleanupFailed) throw new Error("Team index staging cleanup could not be confirmed.");
  }
}
