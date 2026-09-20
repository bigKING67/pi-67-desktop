import { describe, expect, it, vi } from "vitest";
import { isLocalMemorySettingsSnapshot, parseLocalMemorySettingsRequest, type LocalMemorySettingsRequest } from "@pi67/protocol";
import { LocalMemorySettingsController } from "./local-memory-settings-controller.js";
import type { LocalMemoryModelSettings } from "./local-memory-model-settings.js";

const input: LocalMemorySettingsRequest = { extraction: { provider: "fixture", model: "extract" }, embedding: {
  protocol: "openai-compatible", endpoint: "https://example.invalid/v1", model: "embed", dimension: 8,
  apiKey: { action: "replace", value: "synthetic-secret" }
} };
function fixture() {
  let saved: LocalMemoryModelSettings | undefined;
  const store = { load: vi.fn(async () => saved), save: vi.fn(async (value: LocalMemoryModelSettings) => { saved = value; }) };
  return { store, controller: new LocalMemorySettingsController(store) };
}
describe("memory model settings projection", () => {
  it("reveals a saved key only for an explicit matching endpoint request", async () => {
    const { controller } = fixture();
    await expect(controller.revealKey({ endpoint: input.embedding.endpoint })).rejects.toThrow();
    await controller.save(input);
    expect(await controller.revealKey({ endpoint: input.embedding.endpoint })).toBe("synthetic-secret");
    await expect(controller.revealKey({ endpoint: "https://other.invalid" })).rejects.toThrow();
    await expect(controller.revealKey({ endpoint: input.embedding.endpoint, path: "/private" })).rejects.toThrow();
    expect(JSON.stringify(await controller.get())).not.toContain("synthetic-secret");
  });
  it("returns only non-secret configuration and explicit key presence", async () => {
    const { controller } = fixture();
    expect(await controller.get()).toEqual({ status: "unconfigured" });
    const saved = await controller.save(input);
    expect(isLocalMemorySettingsSnapshot(saved)).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("synthetic-secret");
    expect(saved).toMatchObject({ status: "configured", embedding: { hasApiKey: true }, appliesOn: "next-start" });
    expect(await controller.get()).toEqual(saved);
    expect(isLocalMemorySettingsSnapshot({ ...saved, apiKey: "leak" })).toBe(false);
  });
  it("serializes queued replacement and retention and snapshots caller input", async () => {
    const { controller, store } = fixture(); const draft = structuredClone(input);
    const save = controller.save(draft); draft.embedding.endpoint = "https://mutated.invalid/v1";
    const retained = controller.save({ ...input, embedding: { ...input.embedding, apiKey: { action: "keep" } } });
    await save; await retained;
    expect(store.save).toHaveBeenLastCalledWith({ extraction: input.extraction, embedding: { ...input.embedding, apiKey: "synthetic-secret" } });
  });
  it("requires a fresh key for first setup or endpoint changes, preserving prior settings", async () => {
    const { controller, store } = fixture();
    const keep = { ...input, embedding: { ...input.embedding, apiKey: { action: "keep" } } };
    await expect(controller.save(keep)).rejects.toThrow(/replacement/u);
    await controller.save(input);
    await expect(controller.save({ ...keep, embedding: { ...keep.embedding, endpoint: "https://other.invalid/v1" } })).rejects.toThrow(/replacement/u);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(await controller.get()).toMatchObject({ embedding: { endpoint: input.embedding.endpoint } });
  });
  it("rejects unknown keys, bad endpoints and bounds before storage, and recovers after errors", async () => {
    const { controller, store } = fixture();
    for (const patch of [{ endpoint: "http://remote.invalid" }, { endpoint: "https://user:pass@example.invalid" },
      { dimension: 0 }, { model: "\n\0" }, { model: " " }, { apiKey: { action: "keep", value: "hidden" } }, { root: "/tmp" }]) {
      const value = { ...input, embedding: { ...input.embedding, ...patch } };
      expect(parseLocalMemorySettingsRequest(value)).toBeUndefined();
      await expect(controller.save(value)).rejects.toThrow(/Invalid/u);
    }
    expect(store.load).not.toHaveBeenCalled(); expect(store.save).not.toHaveBeenCalled();
    store.save.mockRejectedValueOnce(new Error("encrypted-store-error"));
    await expect(controller.save(input)).rejects.toThrow();
    await expect(controller.save(input)).resolves.toMatchObject({ status: "configured" });
  });
});
