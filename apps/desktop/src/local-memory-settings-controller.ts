import { parseLocalMemoryKeyRevealRequest, parseLocalMemorySettingsRequest, type LocalMemorySettingsSnapshot } from "@pi67/protocol";
import type { LocalMemoryModelSettings, LocalMemoryModelSettingsStore } from "./local-memory-model-settings.js";

/** Sole application settings writer; serializes read/retain/write without exposing keys. */
export class LocalMemorySettingsController {
  #tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: Pick<LocalMemoryModelSettingsStore, "load" | "save">) {}
  get(): Promise<LocalMemorySettingsSnapshot> {
    return this.#serialize(async () => project(await this.store.load()));
  }
  revealKey(value: unknown): Promise<string> {
    const input = parseLocalMemoryKeyRevealRequest(value);
    if (!input) return Promise.reject(new Error("Invalid key reveal request."));
    return this.#serialize(async () => {
      const current = await this.store.load();
      if (!current || current.embedding.endpoint !== input.endpoint) throw new Error("Saved key selection has changed.");
      return current.embedding.apiKey;
    });
  }
  save(value: unknown): Promise<LocalMemorySettingsSnapshot> {
    const input = parseLocalMemorySettingsRequest(value);
    if (!input) return Promise.reject(new Error("Invalid memory settings request."));
    return this.#serialize(async () => {
      const { apiKey, ...embedding } = input.embedding;
      let key: string;
      if (apiKey.action === "keep") {
        const current = await this.store.load();
        if (!current || current.embedding.protocol !== embedding.protocol || current.embedding.endpoint !== embedding.endpoint) {
          throw new Error("A replacement key is required for this endpoint.");
        }
        key = current.embedding.apiKey;
      } else key = apiKey.value;
      const settings = { extraction: input.extraction, embedding: { ...embedding, apiKey: key } };
      await this.store.save(settings);
      return project(settings);
    });
  }
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.#tail.then(operation, operation);
    this.#tail = pending.then(() => undefined, () => undefined);
    return pending;
  }
}
function project(value: LocalMemoryModelSettings | undefined): LocalMemorySettingsSnapshot {
  if (!value) return { status: "unconfigured" };
  return { status: "configured", extraction: { ...value.extraction }, embedding: {
    protocol: value.embedding.protocol, endpoint: value.embedding.endpoint,
    model: value.embedding.model, dimension: value.embedding.dimension, hasApiKey: true
  }, appliesOn: "next-start" };
}
