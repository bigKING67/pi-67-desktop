import { afterEach, expect, it, vi } from "vitest";
import { TeamIndexSettingsClient } from "./team-index-settings-client.js";
const settings = { extraction: { provider: "fixture", model: "extract" }, embedding: {
  protocol: "openai-compatible", endpoint: "https://model.invalid/v1", model: "embed", dimension: 4, apiKey: "synthetic-key"
} };
afterEach(() => vi.useRealTimers());
function fixture() {
  const parent = { postMessage: vi.fn() }, client = new TeamIndexSettingsClient(parent), caller = new AbortController();
  const result = () => ({ type: "team-index-settings-result", requestId: parent.postMessage.mock.calls.find(([value]) => value.type === "team-index-settings-read")![0].requestId, ok: true, settings: structuredClone(settings) });
  return { parent, client, caller, result };
}
it("returns an owned settings snapshot only for its exact pending request", async () => {
  const f = fixture(), run = f.client.load(f.caller.signal), result = f.result();
  expect(f.client.handleMessage({ ...result, extra: true })).toBe(false);
  expect(f.client.handleMessage({ ...result, requestId: "00000000-0000-4000-8000-000000000000" })).toBe(true);
  f.client.handleMessage(result); result.settings.embedding.apiKey = "mutated";
  expect((await run).embedding.apiKey).toBe("synthetic-key"); f.client.shutdown();
});
it.each(["caller", "settings", "shutdown", "timeout"])("cancels pending reads and ignores late secrets on %s", async action => {
  vi.useFakeTimers(); const f = fixture(), generation = f.client.signal;
  const run = f.client.load(f.caller.signal), rejected = expect(run).rejects.toThrow("Team index settings unavailable.");
  if (action === "caller") f.caller.abort();
  if (action === "settings") f.client.handleMessage({ type: "team-index-settings-invalidated" });
  if (action === "shutdown") f.client.shutdown();
  if (action === "timeout") await vi.advanceTimersByTimeAsync(8_000);
  await rejected;
  expect(f.parent.postMessage).toHaveBeenCalledWith({ type: "team-index-settings-cancel", requestId: f.result().requestId });
  f.client.handleMessage(f.result());
  if (action === "settings") { expect(generation.aborted).toBe(true); expect(f.client.signal.aborted).toBe(false); }
  f.client.shutdown();
});
it("retires a previously resolved snapshot lifetime on settings change and allows an explicit new read", async () => {
  const f = fixture(), old = f.client.signal, first = f.client.load(f.caller.signal); f.client.handleMessage(f.result()); await first;
  f.client.handleMessage({ type: "team-index-settings-invalidated" }); expect(old.aborted).toBe(true);
  const next = f.client.load(f.caller.signal), requestId = f.parent.postMessage.mock.calls.at(-1)![0].requestId;
  f.client.handleMessage({ ...f.result(), requestId }); await expect(next).resolves.toEqual(settings); f.client.shutdown();
});
it("caps pending reads, recovers from rejection and fails closed on parent errors/pre-cancel", async () => {
  const f = fixture(), runs = Array.from({ length: 4 }, () => f.client.load(f.caller.signal));
  for (const run of runs) void run.catch(() => undefined);
  await expect(f.client.load(f.caller.signal)).rejects.toThrow("unavailable"); expect(f.parent.postMessage).toHaveBeenCalledTimes(4);
  f.client.handleMessage({ ...f.result(), ok: false, settings: undefined, errorCode: "BUSY" }); // Extra settings must not be accepted.
  f.client.handleMessage({ type: "team-index-settings-result", requestId: f.result().requestId, ok: false, errorCode: "BUSY" });
  f.client.shutdown(); expect((await Promise.allSettled(runs)).every(result => result.status === "rejected")).toBe(true);
  await expect(f.client.load(new AbortController().signal)).rejects.toThrow("unavailable");
  const other = fixture(); other.parent.postMessage.mockImplementation(() => { throw new Error("synthetic-secret"); });
  await expect(other.client.load(other.caller.signal)).rejects.toThrow("Team index settings unavailable.");
  await expect(other.client.load(AbortSignal.abort())).rejects.toThrow("unavailable"); other.client.shutdown();
});
