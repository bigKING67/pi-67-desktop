import type { LocalMemoryModelClient } from "./local-memory-model-client.js";
import type { LocalMemoryModelSettingsStore } from "./local-memory-model-settings.js";
import type { LocalMemoryServiceConfiguration } from "./local-memory-service.mjs";

type RuntimeSelection = Pick<LocalMemoryServiceConfiguration, "runtimeRoot" | "manifest" | "signature" | "dataRoot">;

/** Runtime selection is Main-owned; settings cannot replace the runtime or trust key. */
export function createLocalMemoryConfigurationLoader(options: {
  settings: Pick<LocalMemoryModelSettingsStore, "load">;
  models: Pick<LocalMemoryModelClient, "resolve">;
  loadRuntime(signal: AbortSignal): Promise<RuntimeSelection>;
}): (signal: AbortSignal) => Promise<LocalMemoryServiceConfiguration> {
  return async (signal) => {
    signal.throwIfAborted();
    const settings = await options.settings.load();
    signal.throwIfAborted();
    if (!settings) throw new Error("Local memory models are not configured.");
    const runtime = await options.loadRuntime(signal);
    signal.throwIfAborted();
    const extraction = await options.models.resolve(settings.extraction, signal);
    signal.throwIfAborted();
    return { ...runtime, extraction, embedding: { ...settings.embedding } };
  };
}
