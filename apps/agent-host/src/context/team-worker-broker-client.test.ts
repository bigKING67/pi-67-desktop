import { afterEach, expect, it, vi } from "vitest";
import { TeamWorkerBrokerClient } from "./team-worker-broker-client.js";
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const id = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const postMessage = vi.fn(), client = new TeamWorkerBrokerClient({ postMessage });
  const owner = new AbortController(); let connect!: () => void;
  const connected = new Promise<void>((resolve, reject) => { connect = resolve; owner.signal.addEventListener("abort", () => reject(new Error("port retired")), { once: true }); });
  void connected.catch(() => undefined);
  const reservation: Parameters<TeamWorkerBrokerClient["start"]>[0] = { requestId: id, connected, signal: owner.signal, stop: () => owner.abort(), phase: "worker", activate: vi.fn() };
  const state = (value: string) => client.handleMessage({ type: "team-worker-state", requestId: id, state: value });
  return { client, postMessage, owner, reservation, connect, state };
}
it("requires both port admission and a Main startup receipt", async () => {
  const f = fixture(), ready = f.client.start(f.reservation); let resolved = false;
  void ready.then(() => { resolved = true; }); f.state("prepared"); f.state("started"); await Promise.resolve(); expect(resolved).toBe(false);
  f.connect(); const handle = await ready;
  expect(f.postMessage).toHaveBeenCalledWith({ type: "team-worker-start", requestId: id });
  f.owner.abort(); expect(f.postMessage).toHaveBeenCalledOnce();
  f.state("completed"); await expect(handle.completion).resolves.toBe("completed"); f.client.shutdown();
});
it("preserves only validated fixed worker failure stages through completion", async () => {
  const f = fixture(), ready = f.client.start(f.reservation);
  f.state("prepared"); f.connect(); f.state("started"); const handle = await ready;
  expect(f.client.handleMessage({ type: "team-worker-state", requestId: id, state: "failed", failureStage: "secret payload" })).toBe(false);
  expect(f.client.handleMessage({ type: "team-worker-state", requestId: id, state: "completed", failureStage: "vector-index" })).toBe(false);
  const rejected = expect(handle.completion).rejects.toThrow("unavailable (vector-index)");
  f.client.handleMessage({ type: "team-worker-state", requestId: id, state: "failed", failureStage: "vector-index" });
  await rejected; f.client.shutdown();
});
it("waits for physical cancellation acknowledgement instead of treating stop as completion", async () => {
  const f = fixture(), ready = f.client.start(f.reservation); f.state("prepared"); f.connect(); f.state("started"); const handle = await ready;
  const stopping = handle.stop(); let done = false; void stopping.then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false);
  expect(f.postMessage).toHaveBeenLastCalledWith({ type: "team-worker-cancel", requestId: id });
  f.state("cancelled"); await expect(stopping).resolves.toBe("cancelled"); f.client.shutdown();
});
it.each(["preparation-timeout", "startup-timeout", "abort", "failed", "shutdown", "post-failure"])("rejects startup on %s", async mode => {
  vi.useFakeTimers(); const f = fixture();
  if (mode === "post-failure") f.postMessage.mockImplementation(() => { throw new Error("private"); });
  const rejected = expect(f.client.start(f.reservation)).rejects.toThrow("unavailable");
  if (mode === "preparation-timeout") vi.advanceTimersByTime(65_000);
  if (mode === "startup-timeout") { f.state("prepared"); vi.advanceTimersByTime(5_000); }
  if (mode === "abort") f.owner.abort();
  if (mode === "failed") f.state("failed");
  if (mode === "shutdown") f.client.shutdown();
  await rejected; f.client.shutdown(); expect(vi.getTimerCount()).toBe(0);
});
it("does not claim physical cleanup when terminal acknowledgement times out", async () => {
  vi.useFakeTimers(); const f = fixture(), ready = f.client.start(f.reservation); f.state("prepared"); f.connect(); f.state("started"); const handle = await ready;
  const rejected = expect(handle.stop()).rejects.toThrow("unavailable");
  vi.advanceTimersByTime(20_000); await rejected; f.client.shutdown();
});
it("rejects duplicate start receipts and ignores unmatched or malformed states", async () => {
  const f = fixture(), ready = f.client.start(f.reservation); f.state("prepared"); f.connect(); f.state("started"); const handle = await ready;
  expect(f.client.handleMessage({ type: "team-worker-state", requestId: id, state: "completed", pid: 123 })).toBe(false);
  f.state("started"); expect(f.postMessage).toHaveBeenLastCalledWith({ type: "team-worker-cancel", requestId: id });
  f.state("cancelled"); await handle.completion; f.state("completed"); f.client.shutdown();
});
it("waits through heavy preparation without spending the five-second start window", async () => {
  vi.useFakeTimers(); const f = fixture(), ready = f.client.start(f.reservation);
  vi.advanceTimersByTime(12_000); expect(f.owner.signal.aborted).toBe(false);
  expect(f.reservation.activate).not.toHaveBeenCalled();
  f.state("prepared"); expect(f.reservation.activate).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(4_999); f.connect(); f.state("started"); const handle = await ready;
  f.state("completed"); await expect(handle.completion).resolves.toBe("completed");
  f.client.shutdown(); expect(vi.getTimerCount()).toBe(0);
});
it.each(["early-start", "early-completed", "duplicate-prepared", "activation-failed", "missing-port"])("fails closed on %s", async mode => {
  const f = fixture(), ready = f.client.start(f.reservation), rejected = expect(ready).rejects.toThrow();
  if (mode === "early-start") f.state("started");
  if (mode === "early-completed") f.state("completed");
  if (mode === "activation-failed") vi.mocked(f.reservation.activate).mockImplementationOnce(() => { throw new Error("expired"); });
  if (["duplicate-prepared", "activation-failed", "missing-port"].includes(mode)) f.state("prepared");
  if (mode === "duplicate-prepared") f.state("prepared");
  if (mode === "missing-port") { f.state("started"); f.owner.abort(); }
  await rejected;
  if (mode !== "early-completed") expect(f.postMessage).toHaveBeenLastCalledWith({ type: "team-worker-cancel", requestId: id });
  f.state("prepared"); f.state("started"); f.state("cancelled"); f.client.shutdown();
});
it("rejects ordinary port reservations rather than silently extending their deadline", () => {
  const f = fixture(); f.reservation.phase = "port";
  expect(() => f.client.start(f.reservation)).toThrow("unavailable"); expect(f.owner.signal.aborted).toBe(true);
  expect(f.postMessage).not.toHaveBeenCalled(); f.client.shutdown();
});
it.each(["prepared", "started"])("rejects a late %s receipt even before its timer callback runs", async state => {
  vi.useFakeTimers(); const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const f = fixture(), ready = f.client.start(f.reservation), rejected = expect(ready).rejects.toThrow();
  if (state === "started") f.state("prepared");
  clock.mockReturnValue(state === "prepared" ? 65_001 : 5_001); f.state(state);
  await rejected;
  expect(f.reservation.activate).toHaveBeenCalledTimes(state === "prepared" ? 0 : 1);
  expect(f.postMessage).toHaveBeenLastCalledWith({ type: "team-worker-cancel", requestId: id });
  f.state("cancelled"); f.client.shutdown();
});
