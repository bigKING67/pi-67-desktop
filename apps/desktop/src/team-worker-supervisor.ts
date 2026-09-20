import type { UtilityProcess } from "electron";
import { isTeamWorkerRequest, teamWorkerExitStage, TEAM_WORKER_HANDOFF_TIMEOUT_MS, TEAM_WORKER_PREPARATION_TIMEOUT_MS, type TeamWorkerState } from "@pi67/protocol";
import { startNativeTeamModelWorker, type NativeTeamModelWorkerOptions } from "./native-team-model-worker.mjs";
import { TeamModelPortSupervisor } from "./team-model-port-supervisor.js";
import { TeamIndexScheduler } from "./team-index-scheduler.js";

type Launch = Omit<NativeTeamModelWorkerOptions, "attachModelChannel">;
type Outcome = "completed" | "cancelled";
interface Entry { host: UtilityProcess; start(): void; cancel(): void; completion: Promise<Outcome> }

/** Main's one-shot launch authority. register() is internal: caller must supply a
 * verified runtime/bootstrap, isolated owned cwd and the exact Host reservation.
 * No registration is fabricated from a parent message or Renderer input.
 */
export class TeamWorkerSupervisor {
  readonly ports: TeamModelPortSupervisor;
  readonly indexJobs: TeamIndexScheduler;
  private readonly entries = new Map<string, Entry>();
  private stopped = false;
  private cleanupFailed = false;
  constructor(private readonly currentHost: () => UtilityProcess | undefined,
    private readonly launch = startNativeTeamModelWorker) {
    this.ports = new TeamModelPortSupervisor(currentHost);
    this.indexJobs = new TeamIndexScheduler(currentHost, (id, options, signal, beforeLaunch) => this.register(id, options, signal, beforeLaunch));
  }

  register(requestId: string, options: Launch, signal: AbortSignal, beforeLaunch?: (signal: AbortSignal) => Promise<void>) {
    const host = this.currentHost();
    if (!host || this.stopped || this.cleanupFailed || signal.aborted || this.entries.size >= 4 || this.entries.has(requestId)
      || !isTeamWorkerRequest({ type: "team-worker-start", requestId })) throw new Error("Team worker registration unavailable.");
    const selection = { ...options, arguments: [...options.arguments] };
    const owner = new AbortController();
    let started = false, retired = false;
    let resolve!: (result: Outcome) => void, reject!: (error: Error) => void;
    const completion = new Promise<Outcome>((yes, no) => { resolve = yes; reject = no; });
    void completion.catch(() => undefined);
    const send = (state: TeamWorkerState["state"], failureStage?: TeamWorkerState["failureStage"]) => {
      if (this.currentHost() !== host) return;
      try { host.postMessage({ type: "team-worker-state", requestId, state, ...(failureStage ? { failureStage } : {}) } satisfies TeamWorkerState); }
      catch { cancel(); }
    };
    const finish = (state: Exclude<TeamWorkerState["state"], "started" | "prepared">, failureStage?: TeamWorkerState["failureStage"]) => {
      if (retired) return;
      retired = true; clearTimeout(timer); this.entries.delete(requestId);
      host.off("exit", cancel); signal.removeEventListener("abort", cancel);
      send(state, failureStage);
      if (state === "failed") reject(new Error("Team worker failed; completion cannot certify indexing.")); else resolve(state);
    };
    const cancel = () => { owner.abort(); if (!started) finish("cancelled"); };
    const permitDeadline = performance.now() + TEAM_WORKER_HANDOFF_TIMEOUT_MS;
    let timer = setTimeout(cancel, TEAM_WORKER_HANDOFF_TIMEOUT_MS);
    const start = () => {
      if (started) { cancel(); return; }
      if (retired || signal.aborted || this.currentHost() !== host || performance.now() >= permitDeadline) { cancel(); return; }
      started = true; clearTimeout(timer); timer = setTimeout(cancel, TEAM_WORKER_PREPARATION_TIMEOUT_MS);
      const preparationDeadline = performance.now() + TEAM_WORKER_PREPARATION_TIMEOUT_MS;
      void (async () => {
        let launchAttempted = false;
        try {
          if (beforeLaunch) await beforeLaunch(owner.signal);
          if (owner.signal.aborted || this.currentHost() !== host || performance.now() >= preparationDeadline) { cancel(); finish("cancelled"); return; }
          // Ordered on the same parent channel before model-port transfer. Host
          // activates its short reservation only after complete Main preflight.
          clearTimeout(timer); timer = setTimeout(cancel, TEAM_WORKER_HANDOFF_TIMEOUT_MS);
          const handoffDeadline = performance.now() + TEAM_WORKER_HANDOFF_TIMEOUT_MS;
          send("prepared");
          if (owner.signal.aborted) { finish("cancelled"); return; }
          launchAttempted = true;
          const worker = await this.launch({ ...selection, attachModelChannel: channel => this.ports.attach(requestId, channel, owner.signal) }, owner.signal);
          if (performance.now() >= handoffDeadline) cancel();
          if (!owner.signal.aborted) {
            clearTimeout(timer); timer = setTimeout(cancel, 300_000); send("started");
          }
          const result = await worker.completion;
          if (owner.signal.aborted) finish("cancelled");
          else if (result.code === 0) finish("completed");
          else finish("failed", teamWorkerExitStage(result.code));
        } catch {
          // A low-level launch/cleanup rejection cannot prove physical containment.
          if (launchAttempted) this.cleanupFailed = true;
          if (launchAttempted || !owner.signal.aborted) finish("failed", launchAttempted ? "launch-or-cleanup" : "preparation");
          else finish("cancelled");
        }
      })();
    };
    this.entries.set(requestId, { host, start, cancel, completion });
    host.on("exit", cancel); signal.addEventListener("abort", cancel, { once: true });
    return { cancel, completion };
  }

  handleMessage(host: UtilityProcess, message: unknown): boolean {
    if (!isTeamWorkerRequest(message)) return false;
    if (host !== this.currentHost() || this.stopped) return true;
    const entry = this.entries.get(message.requestId);
    if (!entry || entry.host !== host) {
      try { host.postMessage({ type: "team-worker-state", requestId: message.requestId, state: "failed" } satisfies TeamWorkerState); }
      catch { /* Closed exact parent; no alternate destination or sensitive logging. */ }
      return true;
    }
    if (message.type === "team-worker-start") entry.start(); else entry.cancel();
    return true;
  }

  invalidate(): void { this.indexJobs.invalidate(); for (const entry of this.entries.values()) entry.cancel(); this.ports.invalidate(); }
  async shutdown(): Promise<void> {
    this.stopped = true;
    const pending = [...this.entries.values()].map(entry => entry.completion);
    this.invalidate();
    const [, indexCleanup] = await Promise.allSettled([Promise.allSettled(pending), this.indexJobs.shutdown()]);
    // Failed indexing/preflight is not failed containment. Only native cleanup
    // uncertainty or the index owner's exact staging cleanup blocks shutdown.
    if (this.cleanupFailed || indexCleanup.status === "rejected") throw new Error("Team worker shutdown could not be confirmed.");
  }
}
