import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiConfigurationService } from "@pi67/pi-runtime";
const resolver = vi.hoisted(() => vi.fn());
vi.mock("@pi67/pi-runtime", () => ({ resolveLocalMemoryExtractionModel: resolver }));
import { LocalMemoryModelBroker } from "./local-memory-model-broker.js";

const request = { type: "local-memory-extraction-resolve", requestId: "one", selection: { provider: "fixture", model: "extract" } };
const model = { protocol: "openai-compatible", endpoint: "https://example.invalid/v1", model: "extract", apiKey: "synthetic-secret" };
const configuration: Pick<PiConfigurationService, "createModelRuntime"> = { createModelRuntime: vi.fn() };
afterEach(() => resolver.mockReset());
describe("Host parent-only extraction configuration", () => {
  it("accepts only a bounded explicit model selection and projects a validated private result", async () => {
    const broker = new LocalMemoryModelBroker(configuration); const reply = vi.fn();
    expect(broker.handleMessage({ ...request, endpoint: "https://attacker.invalid" }, reply)).toBe(false);
    expect(broker.handleMessage({ ...request, selection: { ...request.selection, apiKey: "injected" } }, reply)).toBe(false);
    expect(resolver).not.toHaveBeenCalled();
    resolver.mockResolvedValue(model);
    expect(broker.handleMessage(request, reply)).toBe(true);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ type: "local-memory-extraction-result", requestId: "one", ok: true, model }));
    expect(resolver).toHaveBeenCalledWith(configuration, request.selection, expect.any(AbortSignal));
    broker.shutdown();
  });
  it("bounds concurrent requests and discards canceled or shutdown resolutions", async () => {
    const broker = new LocalMemoryModelBroker(configuration); const reply = vi.fn();
    let finish!: (value: unknown) => void;
    resolver.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    broker.handleMessage(request, reply);
    broker.handleMessage({ ...request, requestId: "two" }, reply);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ requestId: "two", errorCode: "BUSY" }));
    broker.handleMessage({ type: "local-memory-extraction-cancel", requestId: "one" }, reply);
    finish(model); await new Promise((resolve) => setImmediate(resolve));
    expect(reply).toHaveBeenCalledTimes(1);
    broker.handleMessage({ ...request, requestId: "three" }, reply);
    broker.shutdown(); finish(model); await new Promise((resolve) => setImmediate(resolve));
    expect(reply).toHaveBeenCalledTimes(1);
  });
  it("does not forward SDK errors or malformed credential-bearing results", async () => {
    for (const value of [undefined, { ...model, apiKey: "x".repeat(5_000) }]) {
      const broker = new LocalMemoryModelBroker(configuration); const reply = vi.fn();
      if (value) resolver.mockResolvedValue(value); else resolver.mockRejectedValue(new Error("synthetic-secret"));
      broker.handleMessage(request, reply);
      await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ type: "local-memory-extraction-result", requestId: "one", ok: false, errorCode: "UNAVAILABLE" }));
      broker.shutdown();
    }
  });
});
