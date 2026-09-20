import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { TeamIndexSettingsBroker } from "./team-index-settings-broker.js";
const settings = { extraction: { provider: "fixture", model: "extract" }, embedding: {
  protocol: "openai-compatible" as const, endpoint: "https://model.invalid/v1", model: "embed", dimension: 4, apiKey: "synthetic-key"
} };
afterEach(() => vi.useRealTimers());
function fixture() {
  let generation = new AbortController();
  const store = { get signal() { return generation.signal; }, load: vi.fn(async () => structuredClone(settings)) };
  const host = { postMessage: vi.fn() }, retired = vi.fn();
  let current: typeof host | undefined = host;
  const broker = new TeamIndexSettingsBroker(() => current, () => store, retired);
  const read = () => { const requestId = randomUUID(); broker.handleMessage(host, { type: "team-index-settings-read", requestId }); return requestId; };
  return { store, host, broker, read, retired, replace() { current = { postMessage: vi.fn() }; return current; },
    change() { const old = generation; generation = new AbortController(); old.abort(); } };
}
it("reads only for the current Host and never accepts caller-supplied paths or settings", async () => {
  const f = fixture(), id = f.read();
  await vi.waitFor(() => expect(f.host.postMessage).toHaveBeenCalledWith({ type: "team-index-settings-result", requestId: id, ok: true, settings }));
  expect(f.broker.handleMessage(f.host, { type: "team-index-settings-read", requestId: randomUUID(), path: "/private" })).toBe(false);
  f.replace(); f.read(); expect(f.store.load).toHaveBeenCalledOnce(); f.broker.stop();
});
it.each(["cancel", "change", "replace", "stop", "retire", "timeout"])("discards late decrypted settings after %s", async action => {
  vi.useFakeTimers(); const f = fixture();
  let release!: (value: typeof settings) => void;
  f.store.load.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const id = f.read();
  if (action === "cancel") f.broker.handleMessage(f.host, { type: "team-index-settings-cancel", requestId: id });
  if (action === "change") f.change();
  if (action === "replace") f.replace();
  if (action === "stop") f.broker.stop();
  if (action === "retire") f.broker.retire();
  if (action === "timeout") await vi.advanceTimersByTimeAsync(5_000);
  release(settings); await vi.advanceTimersByTimeAsync(0);
  expect(f.host.postMessage.mock.calls.every(([value]) => value.type === "team-index-settings-invalidated")).toBe(true);
  if (action === "change") { expect(f.retired).toHaveBeenCalledOnce(); expect(f.host.postMessage).toHaveBeenCalledOnce(); }
  f.broker.stop();
});
it("holds four cancelled reads until IO settles, ignores duplicate IDs and frees capacity afterward", async () => {
  const f = fixture(); let release!: (value: typeof settings) => void;
  f.store.load.mockReturnValue(new Promise(resolve => { release = resolve; }));
  const ids = Array.from({ length: 4 }, f.read);
  f.broker.handleMessage(f.host, { type: "team-index-settings-read", requestId: ids[0] });
  f.broker.retire(); const busy = f.read();
  expect(f.host.postMessage).toHaveBeenCalledWith({ type: "team-index-settings-result", requestId: busy, ok: false, errorCode: "BUSY" });
  expect(f.store.load).toHaveBeenCalledTimes(4);
  release(settings); await new Promise(resolve => setImmediate(resolve));
  const next = f.read(); await vi.waitFor(() => expect(f.host.postMessage).toHaveBeenCalledWith({ type: "team-index-settings-result", requestId: next, ok: true, settings }));
  f.broker.stop();
});
it("rearms generation observation and stops retaining the store listener on shutdown", async () => {
  const f = fixture(); f.read(); await vi.waitFor(() => expect(f.host.postMessage).toHaveBeenCalledOnce());
  f.change(); f.change(); expect(f.retired).toHaveBeenCalledTimes(2);
  f.broker.stop(); f.change(); expect(f.retired).toHaveBeenCalledTimes(2);
});
it("redacts storage failures, rejects private-only settings and handles a closed parent", async () => {
  const f = fixture(); f.store.load.mockRejectedValueOnce(new Error("synthetic-private-secret"));
  const failed = f.read(); await vi.waitFor(() => expect(f.host.postMessage).toHaveBeenCalledWith({ type: "team-index-settings-result", requestId: failed, ok: false, errorCode: "UNAVAILABLE" }));
  f.store.load.mockResolvedValueOnce({ ...settings, embedding: { ...settings.embedding, dimension: 65536 } });
  f.read(); await vi.waitFor(() => expect(f.host.postMessage).toHaveBeenCalledTimes(2));
  expect(JSON.stringify(f.host.postMessage.mock.calls)).not.toContain("synthetic");
  f.host.postMessage.mockImplementation(() => { throw new Error("closed"); }); f.read();
  await new Promise(resolve => setImmediate(resolve)); f.broker.stop();
});
it("returns an unavailable result when no memory store is installed", async () => {
  const host = { postMessage: vi.fn() }, broker = new TeamIndexSettingsBroker(() => host, () => undefined, vi.fn());
  const requestId = randomUUID(); broker.handleMessage(host, { type: "team-index-settings-read", requestId });
  await vi.waitFor(() => expect(host.postMessage).toHaveBeenCalledWith({ type: "team-index-settings-result", requestId, ok: false, errorCode: "UNAVAILABLE" })); broker.stop();
});
