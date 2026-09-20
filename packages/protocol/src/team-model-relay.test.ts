import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { isTeamModelRelayMessage, TEAM_MODEL_RELAY_MAX_CHUNK, TeamModelRelay } from "./team-model-relay.js";
afterEach(() => { vi.useRealTimers(); });
function fixture() {
  const port = Object.assign(new EventEmitter(), { postMessage: vi.fn(), close: vi.fn(), start: vi.fn() });
  const sink = { accept: vi.fn(async (_bytes: Uint8Array) => undefined), close: vi.fn() };
  const relay = new TeamModelRelay(port, sink); relay.start();
  return { port, sink, relay };
}
const packet = (sequence = 1) => ({ type: "team-model-relay-data", sequence, bytes: new Uint8Array([1, 2, 3]) });
it.each([{}, { ...packet(), userId: "injected" }, { ...packet(), sequence: 0 }, { ...packet(), sequence: 1.5 },
  { ...packet(), bytes: new Uint8Array() }, { ...packet(), bytes: new Uint8Array(TEAM_MODEL_RELAY_MAX_CHUNK + 1) },
  { ...packet(), bytes: new Uint8Array(new SharedArrayBuffer(1)) }])("rejects malformed relay messages", value => {
  expect(isTeamModelRelayMessage(value)).toBe(false);
  const f = fixture(); f.port.emit("message", value);
  expect(f.sink.accept).not.toHaveBeenCalled(); expect(f.port.close).toHaveBeenCalledOnce();
});
it("copies outgoing bytes and resolves only after the exact ACK", async () => {
  const f = fixture(), bytes = new Uint8Array([1, 2]); let completed = false;
  const sent = f.relay.write(bytes).then(() => { completed = true; }); bytes.fill(0);
  expect(f.port.postMessage.mock.calls[0]![0].bytes).toEqual(new Uint8Array([1, 2]));
  await Promise.resolve(); expect(completed).toBe(false);
  f.port.emit("message", { data: { type: "team-model-relay-ack", sequence: 1 } }); await sent;
  f.relay.stop();
});
it("acknowledges inbound bytes only after consumption and rejects repeated sequence", async () => {
  const f = fixture(); let release!: () => void;
  f.sink.accept.mockImplementation(() => new Promise(resolve => { release = () => resolve(undefined); }));
  f.port.emit("message", packet()); expect(f.port.postMessage).not.toHaveBeenCalled();
  release(); await Promise.resolve(); expect(f.port.postMessage).toHaveBeenCalledWith({ type: "team-model-relay-ack", sequence: 1 });
  f.port.emit("message", packet()); expect(f.port.close).toHaveBeenCalledOnce(); expect(f.sink.accept).toHaveBeenCalledOnce();
});
it.each(["missing-ack", "wrong-ack", "second-write", "close", "messageerror"])("retires pending outbound work on %s", async mode => {
  vi.useFakeTimers(); const f = fixture();
  const sent = expect(f.relay.write(new Uint8Array([1]))).rejects.toThrow("unavailable");
  if (mode === "missing-ack") vi.advanceTimersByTime(10_000);
  if (mode === "wrong-ack") f.port.emit("message", { type: "team-model-relay-ack", sequence: 2 });
  if (mode === "second-write") await expect(f.relay.write(new Uint8Array([2]))).rejects.toThrow("unavailable");
  if (mode === "close" || mode === "messageerror") f.port.emit(mode);
  await sent; expect(f.sink.close).toHaveBeenCalledOnce(); expect(f.port.listenerCount("message")).toBe(0);
});
it.each(["timeout", "pipeline"])("rejects stalled/pipelined inbound work without a late ACK: %s", async mode => {
  vi.useFakeTimers(); const f = fixture(); let release!: () => void;
  f.sink.accept.mockImplementation(() => new Promise(resolve => { release = () => resolve(undefined); }));
  f.port.emit("message", packet());
  if (mode === "timeout") vi.advanceTimersByTime(10_000); else f.port.emit("message", packet(2));
  release(); await Promise.resolve(); expect(f.port.postMessage).not.toHaveBeenCalled(); expect(f.port.close).toHaveBeenCalledOnce();
});
