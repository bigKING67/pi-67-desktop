import { EventEmitter } from "node:events";
import type { UtilityProcess } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import type { NativeTeamModelWorkerExit, NativeTeamModelWorkerOptions } from "./native-team-model-worker.mjs";
vi.mock("electron", async () => ({ MessageChannelMain: (await import("node:worker_threads")).MessageChannel }));
import { TeamWorkerSupervisor } from "./team-worker-supervisor.js";
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const id = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const host = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  let current: UtilityProcess | undefined = host as unknown as UtilityProcess;
  let exited!: (exit: NativeTeamModelWorkerExit) => void;
  const completion = new Promise<NativeTeamModelWorkerExit>(resolve => { exited = resolve; });
  const launch = vi.fn(async (_options: NativeTeamModelWorkerOptions, _signal: AbortSignal) => ({ pid: 42, completion, stop: async () => undefined }));
  const owner = new AbortController(), supervisor = new TeamWorkerSupervisor(() => current, launch);
  const options = { python: "/fixture/python", bootstrap: "/fixture/team.py", cwd: "/fixture/staging", arguments: ["fixture"] };
  const register = () => supervisor.register(id, options, owner.signal);
  const message = (type = "team-worker-start") => supervisor.handleMessage(host as unknown as UtilityProcess, { type, requestId: id });
  return { host, launch, owner, supervisor, options, register, message, exited, replace() { current = undefined; } };
}
it("requires a Main permit and rejects paths or malformed IDs from Host messages", async () => {
  const f = fixture(); f.message();
  expect(f.host.postMessage).toHaveBeenCalledWith({ type: "team-worker-state", requestId: id, state: "failed" });
  expect(f.supervisor.handleMessage(f.host as unknown as UtilityProcess, { type: "team-worker-start", requestId: id, python: "/untrusted" })).toBe(false);
  expect(f.supervisor.handleMessage(f.host as unknown as UtilityProcess, { type: "team-worker-start", requestId: "invalid" })).toBe(false);
  expect(f.launch).not.toHaveBeenCalled(); await f.supervisor.shutdown();
});
it("copies Main launch configuration and confirms completion only after physical exit", async () => {
  const f = fixture(), registration = f.register(); f.options.arguments[0] = "changed"; f.message();
  await Promise.resolve(); expect(f.launch.mock.calls[0]![0].arguments).toEqual(["fixture"]);
  expect(f.host.postMessage).toHaveBeenCalledWith({ type: "team-worker-state", requestId: id, state: "started" });
  let finished = false; void registration.completion.then(() => { finished = true; });
  await Promise.resolve(); expect(finished).toBe(false);
  f.exited({ code: 0, signal: null }); await expect(registration.completion).resolves.toBe("completed");
  expect(f.host.listenerCount("exit")).toBe(0); await f.supervisor.shutdown();
});
it.each([[71, "runtime"], [72, "input"], [73, "storage-init"], [74, "vector-index"], [75, "storage-close"], [76, "result-receipt"], [70, "worker-exit"], [null, "worker-exit"]])(
  "reports fixed stage for physical exit %s without publishing", async (code, failureStage) => {
    const f = fixture(), registration = f.register(); f.message(); await Promise.resolve();
    const rejected = expect(registration.completion).rejects.toThrow("Team worker failed");
    f.exited({ code: code as number | null, signal: null }); await rejected;
    expect(f.host.postMessage).toHaveBeenCalledWith({ type: "team-worker-state", requestId: id, state: "failed", failureStage });
    await f.supervisor.shutdown();
  }
);
it.each(["cancel", "invalidate", "owner", "exit", "duplicate", "deadline"])("cancels without claiming early exit on %s", async mode => {
  vi.useFakeTimers(); const f = fixture(), registration = f.register(); f.message(); await Promise.resolve();
  if (mode === "cancel") f.message("team-worker-cancel");
  if (mode === "invalidate") f.supervisor.invalidate();
  if (mode === "owner") f.owner.abort();
  if (mode === "exit") f.host.emit("exit", 1);
  if (mode === "duplicate") f.message();
  if (mode === "deadline") vi.advanceTimersByTime(300_000);
  expect(f.launch.mock.calls[0]![1].aborted).toBe(true); expect(f.launch).toHaveBeenCalledOnce();
  expect(f.host.postMessage.mock.calls.some(([message]) => message.state === "cancelled")).toBe(false);
  f.exited({ code: null, signal: "SIGTERM" }); await expect(registration.completion).resolves.toBe("cancelled");
  await f.supervisor.shutdown(); expect(vi.getTimerCount()).toBe(0);
});
it("expires unused permits and rejects requests from a replacement destination", async () => {
  vi.useFakeTimers(); const f = fixture(), registration = f.register();
  expect(() => f.register()).toThrow("unavailable");
  f.replace(); f.message(); expect(f.launch).not.toHaveBeenCalled();
  vi.advanceTimersByTime(5_000); await expect(registration.completion).resolves.toBe("cancelled");
  expect(f.host.postMessage).not.toHaveBeenCalled(); await f.supervisor.shutdown();
});
it("bounds Main launch permits across pending and running workers", async () => {
  const f = fixture();
  const registrations = Array.from({ length: 4 }, (_, index) => f.supervisor.register(
    `11111111-1111-4111-8111-11111111111${index}`, f.options, f.owner.signal));
  expect(() => f.supervisor.register("11111111-1111-4111-8111-111111111119", f.options, f.owner.signal)).toThrow("unavailable");
  f.owner.abort(); await Promise.all(registrations.map(entry => entry.completion));
  expect(f.launch).not.toHaveBeenCalled(); await f.supervisor.shutdown();
});
it("makes Main shutdown wait for the worker completion receipt", async () => {
  const f = fixture(); f.register(); f.message(); await Promise.resolve();
  const shutdown = f.supervisor.shutdown(); let done = false; void shutdown.then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false); expect(f.launch.mock.calls[0]![1].aborted).toBe(true);
  f.exited({ code: null, signal: "SIGTERM" }); await shutdown;
  expect(() => f.register()).toThrow("unavailable");
});
it("keeps cleanup failure observable and blocks fresh launch permits", async () => {
  const f = fixture(); f.launch.mockRejectedValueOnce(new Error("private native detail"));
  const registration = f.register(); f.message();
  await expect(registration.completion).rejects.toThrow("Team worker failed");
  expect(() => f.register()).toThrow("unavailable");
  await expect(f.supervisor.shutdown()).rejects.toThrow("could not be confirmed");
  expect(JSON.stringify(f.host.postMessage.mock.calls)).not.toContain("private native detail");
});
it("cancels a pending preflight and waits without classifying a no-spawn refusal as failed containment", async () => {
  const f = fixture(); let finish!: () => void;
  const preflight = new Promise<void>(resolve => { finish = resolve; });
  const registration = f.supervisor.register(id, f.options, f.owner.signal, async () => preflight);
  f.message(); const shutdown = f.supervisor.shutdown();
  let done = false; void shutdown.then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false); expect(f.launch).not.toHaveBeenCalled();
  finish(); await expect(registration.completion).resolves.toBe("cancelled"); await shutdown;
  expect(f.launch).not.toHaveBeenCalled();
});
it("never labels a cancelled native cleanup rejection as confirmed cancellation", async () => {
  const f = fixture(); let fail!: (error: Error) => void;
  f.launch.mockImplementationOnce(async () => new Promise<never>((_resolve, reject) => { fail = reject; }));
  const registration = f.register(); f.message(); f.owner.abort(); fail(new Error("unconfirmed physical exit"));
  await expect(registration.completion).rejects.toThrow("Team worker failed");
  expect(f.host.postMessage).toHaveBeenCalledWith({ type: "team-worker-state", requestId: id, state: "failed", failureStage: "launch-or-cleanup" });
  await expect(f.supervisor.shutdown()).rejects.toThrow("could not be confirmed");
});
it("acknowledges preparation only after full preflight, preserving the later short handoff budget", async () => {
  vi.useFakeTimers(); const f = fixture(); let finish!: () => void;
  const preflight = new Promise<void>(resolve => { finish = resolve; });
  const permit = f.supervisor.register(id, f.options, f.owner.signal, async () => preflight);
  f.message(); vi.advanceTimersByTime(12_000);
  expect(f.launch).not.toHaveBeenCalled(); expect(f.host.postMessage).not.toHaveBeenCalled();
  finish(); await vi.advanceTimersByTimeAsync(0);
  expect(f.launch).toHaveBeenCalledOnce();
  expect(f.host.postMessage.mock.calls.map(([message]) => message.state)).toEqual(["prepared", "started"]);
  f.exited({ code: 0, signal: null }); await expect(permit.completion).resolves.toBe("completed");
  await f.supervisor.shutdown(); expect(vi.getTimerCount()).toBe(0);
});
it("cancels over-budget preflight and never sends a late prepared receipt", async () => {
  vi.useFakeTimers(); const f = fixture(); let finish!: () => void;
  const preflight = new Promise<void>(resolve => { finish = resolve; });
  const permit = f.supervisor.register(id, f.options, f.owner.signal, async () => preflight);
  f.message(); vi.advanceTimersByTime(60_000); finish();
  await expect(permit.completion).resolves.toBe("cancelled");
  expect(f.launch).not.toHaveBeenCalled();
  expect(f.host.postMessage.mock.calls.map(([message]) => message.state)).toEqual(["cancelled"]);
  await f.supervisor.shutdown(); expect(vi.getTimerCount()).toBe(0);
});
it("cancels a slow native spawn after preparation without announcing started or early cleanup", async () => {
  vi.useFakeTimers(); const f = fixture(); let spawned!: () => void;
  const held = new Promise<void>(resolve => { spawned = resolve; });
  f.launch.mockImplementationOnce(async () => { await held; return { pid: 42, completion: Promise.resolve({ code: null, signal: "SIGTERM" as const }), stop: async () => undefined }; });
  const permit = f.register(); f.message(); vi.advanceTimersByTime(5_000);
  expect(f.host.postMessage.mock.calls.map(([message]) => message.state)).toEqual(["prepared"]);
  spawned(); await expect(permit.completion).resolves.toBe("cancelled");
  expect(f.host.postMessage.mock.calls.map(([message]) => message.state)).toEqual(["prepared", "cancelled"]);
  await f.supervisor.shutdown(); expect(vi.getTimerCount()).toBe(0);
});
it("does not resurrect expired preparation when its timer callback has not run", async () => {
  vi.useFakeTimers(); const clock = vi.spyOn(performance, "now").mockReturnValue(0), f = fixture();
  const permit = f.supervisor.register(id, f.options, f.owner.signal, async () => { clock.mockReturnValue(60_001); });
  f.message(); await expect(permit.completion).resolves.toBe("cancelled");
  expect(f.launch).not.toHaveBeenCalled();
  expect(f.host.postMessage.mock.calls.map(([message]) => message.state)).toEqual(["cancelled"]);
  await f.supervisor.shutdown();
});
