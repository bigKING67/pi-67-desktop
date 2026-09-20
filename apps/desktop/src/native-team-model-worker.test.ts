import { EventEmitter } from "node:events";
import { Duplex } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { startNativeTeamModelWorker } from "./native-team-model-worker.mjs";

const native = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => native);
vi.mock("node:os", () => ({ release: () => "23.0.0" }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); native.spawn.mockReset(); });

function fixture() {
  const channel = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
  const child = Object.assign(new EventEmitter(), { pid: 4242, stdio: [null, null, null, channel] });
  let alive = true, resistTerm = false;
  const kill = vi.fn((pid: number, signal: NodeJS.Signals | 0) => {
    expect(pid).toBe(-4242);
    if (!alive) throw Object.assign(new Error("gone"), { code: "ESRCH" });
    if (signal === 0 || signal === "SIGTERM" && resistTerm) return true;
    alive = false;
    queueMicrotask(() => { child.emit("exit", null, signal); child.emit("close"); });
    return true;
  });
  vi.stubGlobal("process", { ...process, platform: "darwin", arch: "arm64", kill });
  native.spawn.mockImplementation(() => { queueMicrotask(() => child.emit("spawn")); return child; });
  const controller = new AbortController(), relayStop = vi.fn();
  const options = { python: "/managed/bin/python3.12", bootstrap: "/app/team-worker.py", cwd: "/team-staging", arguments: [] as string[],
    attachModelChannel: vi.fn((_channel: Duplex) => ({ stop: relayStop })) };
  return { child, channel, controller, options, kill, relayStop, resist: () => { resistTerm = true; } };
}
it("uses a dedicated FD, stripped environment and no private runtime configuration", async () => {
  const f = fixture(); const worker = await startNativeTeamModelWorker(f.options, f.controller.signal);
  expect(native.spawn).toHaveBeenCalledWith(f.options.python, ["-I", "-B", f.options.bootstrap], {
    cwd: "/team-staging", detached: true, stdio: ["ignore", "ignore", "ignore", "pipe"],
    env: { PATH: "/usr/bin:/bin", PYTHONUNBUFFERED: "1", LITELLM_LOCAL_MODEL_COST_MAP: "True" }
  });
  expect(f.options.attachModelChannel).toHaveBeenCalledWith(f.channel);
  f.controller.abort(); await worker.completion;
  expect(f.relayStop).toHaveBeenCalledOnce(); expect(worker.stop()).toBe(worker.stop());
});
it.each(["cancelled", "relative-path", "arguments", "unsupported"])("rejects %s before creating a process", async kind => {
  const f = fixture();
  if (kind === "cancelled") f.controller.abort();
  if (kind === "relative-path") f.options.cwd = "relative";
  if (kind === "arguments") f.options.arguments = ["invalid\0switch"];
  if (kind === "unsupported") vi.stubGlobal("process", { ...process, platform: "win32" });
  await expect(startNativeTeamModelWorker(f.options, f.controller.signal)).rejects.toThrow();
  expect(native.spawn).not.toHaveBeenCalled(); expect(f.options.attachModelChannel).not.toHaveBeenCalled();
});
it.each([false, true])("redacts launch errors and never attaches a failed worker: synchronous=%s", async synchronous => {
  const f = fixture();
  native.spawn.mockImplementation(() => {
    if (synchronous) throw new Error("sensitive startup context");
    queueMicrotask(() => { f.child.emit("error", new Error("sensitive startup context")); f.child.emit("close"); });
    return f.child;
  });
  await expect(startNativeTeamModelWorker(f.options, f.controller.signal)).rejects.toThrow(/Team worker (could not be launched|startup failed)/);
  expect(f.options.attachModelChannel).not.toHaveBeenCalled(); expect(f.kill).not.toHaveBeenCalled();
});
it("cleans a launched process after relay attachment throws", async () => {
  const f = fixture(); f.options.attachModelChannel.mockImplementation(() => { throw new Error("sensitive relay context"); });
  await expect(startNativeTeamModelWorker(f.options, f.controller.signal)).rejects.toThrow("Team worker startup failed.");
  expect(f.kill).toHaveBeenCalledWith(-4242, "SIGTERM"); expect(f.channel.destroyed).toBe(true);
});
it("closes a late relay when cancellation occurs inside attachment", async () => {
  const f = fixture(); f.options.attachModelChannel.mockImplementation(() => { f.controller.abort(); return { stop: f.relayStop }; });
  await expect(startNativeTeamModelWorker(f.options, f.controller.signal)).rejects.toThrow("Team worker startup failed.");
  expect(f.relayStop).toHaveBeenCalledOnce(); expect(f.kill).toHaveBeenCalledWith(-4242, "SIGTERM");
});
it("escalates a TERM-resistant worker and waits for confirmed exit", async () => {
  const f = fixture(); f.resist(); const worker = await startNativeTeamModelWorker(f.options, f.controller.signal);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const stopped = worker.stop();
  expect(f.kill).not.toHaveBeenCalledWith(-4242, "SIGKILL");
  await vi.advanceTimersByTimeAsync(3_000); await stopped;
  expect(f.kill).toHaveBeenCalledWith(-4242, "SIGKILL");
});
it("cleans descendants after root exit and treats channel EOF as retirement", async () => {
  const f = fixture(); const worker = await startNativeTeamModelWorker(f.options, f.controller.signal);
  f.child.emit("exit", 0, null); await worker.completion;
  expect(f.kill).toHaveBeenCalledWith(-4242, "SIGTERM"); expect(f.relayStop).toHaveBeenCalledOnce();
  const g = fixture(); const next = await startNativeTeamModelWorker(g.options, g.controller.signal);
  g.channel.emit("end"); await next.completion; expect(g.relayStop).toHaveBeenCalledOnce();
});
it("does not report cleanup success when group signaling is denied", async () => {
  const f = fixture(); const worker = await startNativeTeamModelWorker(f.options, f.controller.signal);
  f.kill.mockImplementation(() => { throw Object.assign(new Error("denied"), { code: "EPERM" }); });
  await expect(worker.stop()).rejects.toThrow("terminate-group, EPERM");
  await expect(worker.completion).rejects.toThrow("cleanup could not be confirmed");
});
it("accepts only a fresh absent-group probe after a signal races natural exit", async () => {
  const f = fixture(); const worker = await startNativeTeamModelWorker(f.options, f.controller.signal);
  f.kill.mockImplementation((_pid, signal) => {
    throw Object.assign(new Error("synthetic group state"), { code: signal === 0 ? "ESRCH" : "EPERM" });
  });
  f.child.emit("exit", 0, null); f.child.emit("close");
  await expect(worker.completion).resolves.toMatchObject({ code: 0 });
  expect(f.kill).toHaveBeenCalledWith(-4242, 0);
});
it("keeps the admitted positive process-group identity after the child handle changes", async () => {
  const f = fixture(); const worker = await startNativeTeamModelWorker(f.options, f.controller.signal);
  f.child.pid = -1;
  await worker.stop(); expect(worker.pid).toBe(4242);
  expect(f.kill).toHaveBeenCalledWith(-4242, "SIGTERM");
});
