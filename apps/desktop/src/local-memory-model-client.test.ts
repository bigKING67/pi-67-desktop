import { EventEmitter } from "node:events";
import type { UtilityProcess } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalMemoryModelClient } from "./local-memory-model-client.js";

const model = { protocol: "openai-compatible", endpoint: "https://example.invalid/v1", model: "extract", apiKey: "synthetic-secret" };
const selection = { provider: "fixture", model: "extract" };
function host() { return Object.assign(new EventEmitter(), { postMessage: vi.fn() }); }
function asHost(value: ReturnType<typeof host>) { return value as unknown as UtilityProcess; }
function result(value: ReturnType<typeof host>) {
  const request = value.postMessage.mock.calls[0]![0] as { requestId: string };
  return { type: "local-memory-extraction-result", requestId: request.requestId, ok: true, model };
}
afterEach(() => vi.useRealTimers());
describe("Main private model resolution", () => {
  it("correlates the selected model and releases listeners after one response", async () => {
    const current = host(); const client = new LocalMemoryModelClient(() => asHost(current));
    const pending = client.resolve(selection, new AbortController().signal);
    await expect(client.resolve(selection, new AbortController().signal)).rejects.toThrow(/unavailable/u);
    expect(current.postMessage).toHaveBeenCalledWith(expect.objectContaining({ selection, type: "local-memory-extraction-resolve" }));
    current.emit("message", { ...result(current), requestId: "wrong" });
    current.emit("message", result(current));
    await expect(pending).resolves.toEqual(model);
    expect(current.listenerCount("message")).toBe(0);
    expect(current.listenerCount("exit")).toBe(0);
  });
  it("ignores malformed secret payloads and fails on timeout with cancellation", async () => {
    vi.useFakeTimers(); const current = host();
    const client = new LocalMemoryModelClient(() => asHost(current));
    const rejected = expect(client.resolve(selection, new AbortController().signal)).rejects.toThrow(/unavailable/u);
    current.emit("message", { ...result(current), model: { ...model, endpoint: "http://remote.invalid" } });
    await vi.advanceTimersByTimeAsync(20_000); await rejected;
    expect(current.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "local-memory-extraction-cancel" }));
    expect(current.listenerCount("message")).toBe(0);
  });
  it("rejects late credentials after Host replacement, cancellation and exit", async () => {
    const old = host(); const replacement = host(); let active = asHost(old);
    const client = new LocalMemoryModelClient(() => active);
    const first = expect(client.resolve(selection, new AbortController().signal)).rejects.toThrow(/unavailable/u);
    active = asHost(replacement); old.emit("message", result(old)); await first;
    expect(replacement.postMessage).not.toHaveBeenCalled();
    const controller = new AbortController();
    const second = expect(client.resolve(selection, controller.signal)).rejects.toThrow(/unavailable/u);
    controller.abort(); await second;
    replacement.emit("message", result(replacement));
    const third = expect(client.resolve(selection, new AbortController().signal)).rejects.toThrow(/unavailable/u);
    replacement.emit("exit", 1); await third;
    expect(replacement.listenerCount("message")).toBe(0);
  });
  it("rejects an absent or broken Host without exposing its native error", async () => {
    await expect(new LocalMemoryModelClient(() => undefined).resolve(selection, new AbortController().signal)).rejects.toThrow(/unavailable/u);
    const current = host(); current.postMessage.mockImplementation(() => { throw new Error("synthetic-secret"); });
    await expect(new LocalMemoryModelClient(() => asHost(current)).resolve(selection, new AbortController().signal))
      .rejects.toThrow("Memory extraction configuration is unavailable.");
    expect(current.listenerCount("message")).toBe(0);
  });
});
