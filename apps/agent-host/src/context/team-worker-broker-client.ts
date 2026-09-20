import { isTeamWorkerState, TEAM_WORKER_HANDOFF_TIMEOUT_MS, TEAM_WORKER_PREPARATION_TIMEOUT_MS, type TeamWorkerRequest, type TeamWorkerState } from "@pi67/protocol";
import type { TeamModelPortAdmission } from "./team-model-port-admission.js";

type Reservation = ReturnType<TeamModelPortAdmission["reserve"]>;
type Outcome = "completed" | "cancelled";
interface Pending { state(value: TeamWorkerState): void; cancel(): void; fail(): void }

/** Host internal worker owner only. Start requires a Main-prepared launch permit
 * for this exact reservation. No executable paths or model credentials cross IPC.
 */
export class TeamWorkerBrokerClient {
  private readonly pending = new Map<string, Pending>();
  private stopped = false;
  constructor(private readonly parent: { postMessage(message: TeamWorkerRequest): void }) {}

  start(reservation: Reservation) {
    if (this.stopped || reservation.phase !== "worker" || reservation.signal.aborted || this.pending.size >= 4 || this.pending.has(reservation.requestId)) {
      reservation.stop(); throw new Error("Team worker startup unavailable.");
    }
    let resolveStarted!: () => void, rejectStarted!: (error: Error) => void;
    let resolveDone!: (outcome: Outcome) => void, rejectDone!: (error: Error) => void;
    let prepared = false, started = false, connected = false, retired = false, cancelling = false;
    const startup = new Promise<void>((yes, no) => { resolveStarted = yes; rejectStarted = no; });
    const completion = new Promise<Outcome>((yes, no) => { resolveDone = yes; rejectDone = no; });
    void completion.catch(() => undefined);
    let failureStage: TeamWorkerState["failureStage"];
    const error = () => new Error(`Team worker lifecycle unavailable${failureStage ? ` (${failureStage})` : ""}.`);
    const finish = (outcome?: Outcome) => {
      if (retired) return;
      retired = true; clearTimeout(timer); this.pending.delete(reservation.requestId);
      reservation.signal.removeEventListener("abort", portRetired); reservation.stop();
      if (!started) rejectStarted(error());
      if (outcome) resolveDone(outcome); else rejectDone(error());
    };
    const send = (type: TeamWorkerRequest["type"]) => {
      try { this.parent.postMessage({ type, requestId: reservation.requestId }); }
      catch { finish(); }
    };
    const cancel = () => {
      if (retired || cancelling) return;
      cancelling = true; reservation.stop(); rejectStarted(error());
      clearTimeout(timer); timer = setTimeout(() => finish(), 20_000);
      send("team-worker-cancel");
    };
    const portRetired = () => {
      if (!started || !connected) { cancel(); return; }
      // Main already retires the native process when the model port closes.
      // Await its terminal receipt; an EOF alone cannot classify successful exit.
      clearTimeout(timer); timer = setTimeout(() => finish(), 20_000);
    };
    let timer = setTimeout(cancel, TEAM_WORKER_PREPARATION_TIMEOUT_MS + TEAM_WORKER_HANDOFF_TIMEOUT_MS);
    let startupDeadline = performance.now() + TEAM_WORKER_PREPARATION_TIMEOUT_MS + TEAM_WORKER_HANDOFF_TIMEOUT_MS;
    this.pending.set(reservation.requestId, { cancel, fail: () => finish(), state: message => {
      const state = message.state;
      if (state === "failed") failureStage = message.failureStage;
      if ((state === "prepared" || state === "started") && performance.now() >= startupDeadline) { cancel(); return; }
      if (state === "prepared") {
        if (prepared || cancelling) { cancel(); return; }
        try { reservation.activate(); } catch { cancel(); return; }
        prepared = true; clearTimeout(timer); timer = setTimeout(cancel, TEAM_WORKER_HANDOFF_TIMEOUT_MS);
        startupDeadline = performance.now() + TEAM_WORKER_HANDOFF_TIMEOUT_MS;
      } else if (state === "started") {
        if (!prepared || started || cancelling) { cancel(); return; }
        started = true; clearTimeout(timer); timer = setTimeout(cancel, 300_000); resolveStarted();
      } else finish(state === "cancelled" || state === "completed" && started && connected && !cancelling ? state : undefined);
    } });
    reservation.signal.addEventListener("abort", portRetired, { once: true });
    const ready = Promise.all([startup, reservation.connected.then(() => { connected = true; })]).then(() => {
      if (retired || cancelling) throw error();
      return { completion, stop: () => { cancel(); return completion; } };
    });
    void ready.catch(cancel);
    send("team-worker-start");
    return ready;
  }

  handleMessage(message: unknown): boolean {
    if (!isTeamWorkerState(message)) return false;
    this.pending.get(message.requestId)?.state(message); return true;
  }
  shutdown(): void {
    this.stopped = true;
    for (const entry of this.pending.values()) { entry.cancel(); entry.fail(); }
  }
}
