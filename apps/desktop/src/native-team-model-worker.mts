import { spawn } from "node:child_process";
import type { Duplex } from "node:stream";
import { isAbsolute } from "node:path";
import { release } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

export interface NativeTeamModelWorkerOptions {
  /** Main-admitted interpreter and application-owned bootstrap, never Host/Renderer input.
   * Caller must verify the signed runtime tree before invoking this low-level adapter.
   * This adapter does not provision storage, adopt private data or certify installation.
   */
  python: string;
  bootstrap: string;
  cwd: string;
  /** Non-sensitive bootstrap switches only; credentials/content belong on private IPC. */
  arguments: readonly string[];
  /** Synchronous Main-owned FD3 binding; legacy name covers both model relay and
   * the query bootstrap's one-shot vector protocol. Handle owns its listeners. */
  attachModelChannel(channel: Duplex): { stop(): void };
}

export interface NativeTeamModelWorkerExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** No caller may infer physical exit or remove a worker's files on this error. */
export class NativeTeamWorkerCleanupError extends Error {}

/** Isolated macOS process group, with only FD 3 for the admitted bootstrap's
 * private model or one-shot vector-query protocol. No private-runtime
 * dependency or HTTP listener. Spawn completion is not application readiness.
 * Completion/stop settle only after the root, inherited pipes and process group end.
 */
export async function startNativeTeamModelWorker(options: NativeTeamModelWorkerOptions, signal: AbortSignal) {
  signal.throwIfAborted();
  if (process.platform !== "darwin" || process.arch !== "arm64" || Number(release().split(".")[0]) < 23) {
    throw new Error("Team memory workers require verified macOS 14+ arm64 containment.");
  }
  if (![options.python, options.bootstrap, options.cwd].every(path => isAbsolute(path) && !path.includes("\0"))
    || options.arguments.length > 8 || options.arguments.some(value => value.length > 512 || /\p{Cc}/u.test(value))) {
    throw new Error("Invalid Main-owned team worker launch configuration.");
  }
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(options.python, ["-I", "-B", options.bootstrap, ...options.arguments], {
      cwd: options.cwd, detached: true, stdio: ["ignore", "ignore", "ignore", "pipe"],
      env: { PATH: "/usr/bin:/bin", PYTHONUNBUFFERED: "1", LITELLM_LOCAL_MODEL_COST_MAP: "True" }
    });
  } catch { throw new Error("Team worker could not be launched."); }
  const channel = child.stdio[3] as Duplex;
  let rootExit: NativeTeamModelWorkerExit = { code: null, signal: null };
  let launched = false, settled = false;
  let groupId: number | undefined;
  let containmentFailure = "none";
  let relay: { stop(): void } | undefined;
  let stopPromise: Promise<void> | undefined;
  let resolveRoot!: () => void, resolveClosed!: () => void;
  const rootDone = new Promise<void>(resolve => { resolveRoot = resolve; });
  const pipesClosed = new Promise<void>(resolve => { resolveClosed = resolve; });
  let resolveCompletion!: (value: NativeTeamModelWorkerExit) => void, rejectCompletion!: (error: Error) => void;
  const completion = new Promise<NativeTeamModelWorkerExit>((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
  void completion.catch(() => undefined); // Owner may still be awaiting spawn admission.
  const retire = () => { void stop().catch(() => undefined); };
  child.once("exit", (code, exitSignal) => { rootExit = { code, signal: exitSignal }; resolveRoot(); retire(); });
  child.once("close", resolveClosed);
  child.once("error", () => { resolveRoot(); retire(); });
  channel.on("error", retire); channel.once("end", retire); channel.once("close", retire);
  signal.addEventListener("abort", retire, { once: true });

  function killGroup(killSignal: NodeJS.Signals | 0): boolean {
    if (!launched || groupId === undefined) return false;
    try { process.kill(-groupId, killSignal); return true; }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") return false;
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      containmentFailure = typeof code === "string" && /^[A-Z_]{2,32}$/u.test(code) ? code : "UNKNOWN";
      throw new Error("Team worker process containment failed.");
    }
  }
  async function waitWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
    } finally { clearTimeout(timer); }
  }
  async function confirmGroupAbsent() {
    const deadline = Date.now() + 2_000;
    while (true) {
      try { if (!killGroup(0)) return; }
      catch { if (containmentFailure !== "EPERM") throw new Error("Team worker group probe failed."); }
      if (Date.now() >= deadline) throw new Error("Team worker group absence could not be confirmed.");
      await delay(25);
    }
  }
  async function signalGroup(killSignal: NodeJS.Signals) {
    try { killGroup(killSignal); }
    catch {
      // macOS can reject signals to a zombie before Node receives/reaps exit.
      // Wait for that concrete state transition before rechecking descendants.
      if (containmentFailure !== "EPERM" || !await waitWithin(rootDone, 3_000)) throw new Error("Team worker root exit was not confirmed.");
      try { killGroup(killSignal); }
      catch {
        if (containmentFailure !== "EPERM") throw new Error("Team worker group signaling failed.");
        await confirmGroupAbsent(); // EPERM alone never establishes termination.
      }
    }
  }
  function stop(): Promise<void> {
    let stage = "relay";
    stopPromise ??= (async () => {
      signal.removeEventListener("abort", retire);
      let relayFailed = false;
      try { relay?.stop(); } catch { relayFailed = true; }
      channel.destroy();
      stage = "terminate-group";
      await signalGroup("SIGTERM");
      await waitWithin(rootDone, 3_000);
      // A root exit alone does not prove its descendants or inherited pipes ended.
      await signalGroup("SIGKILL");
      stage = "root-and-pipes";
      if (!await waitWithin(rootDone, 2_000) || !await waitWithin(pipesClosed, 2_000)) {
        throw new Error("Team worker exit could not be confirmed.");
      }
      stage = "remaining-group";
      await confirmGroupAbsent();
      stage = "relay";
      if (relayFailed) throw new Error("Team worker relay cleanup failed.");
    })().then(() => { settled = true; resolveCompletion(rootExit); }, () => {
      settled = true;
      const error = new NativeTeamWorkerCleanupError(`Team worker cleanup could not be confirmed (${stage}, ${containmentFailure}).`);
      rejectCompletion(error); throw error;
    });
    return stopPromise;
  }
  try {
    const spawned = new Promise<void>((resolve, reject) => {
      child.once("spawn", () => {
        const pid = child.pid;
        if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 1) { reject(new Error("Invalid team worker process identity.")); return; }
        groupId = pid; launched = true; resolve();
      });
      child.once("error", () => reject(new Error("Team worker could not be launched.")));
    });
    if (!await waitWithin(spawned, 5_000)) throw new Error("Team worker launch timed out.");
    signal.throwIfAborted();
    if (stopPromise || settled) throw new Error("Team worker exited during startup.");
    relay = options.attachModelChannel(channel);
    if (signal.aborted || stopPromise) { relay.stop(); throw new Error("Team worker startup was cancelled."); }
    return { pid: groupId!, completion, stop };
  } catch {
    await stop();
    throw new Error("Team worker startup failed.");
  }
}
