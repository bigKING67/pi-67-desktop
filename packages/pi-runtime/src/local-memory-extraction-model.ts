import type { PiDefaultModelSelection } from "@pi67/protocol";
import type { PiConfigurationService } from "./pi-configuration-service.js";

/** Secret-bearing Host/Main-only value. Never include it in a Renderer snapshot. */
export interface LocalMemoryExtractionModel {
  protocol: "openai-compatible";
  endpoint: string;
  model: string;
  apiKey: string;
}

/** Resolve through Pi, never by rereading auth.json or constructing a second catalog. */
export async function resolveLocalMemoryExtractionModel(
  configuration: Pick<PiConfigurationService, "createModelRuntime">,
  selection: PiDefaultModelSelection,
  signal: AbortSignal
): Promise<LocalMemoryExtractionModel> {
  signal.throwIfAborted();
  if (!selection.provider.trim() || !selection.model.trim()) throw new Error("Select an explicit memory extraction model.");
  let runtime;
  try { runtime = await configuration.createModelRuntime(); }
  catch {
    signal.throwIfAborted();
    throw new Error("Pi model configuration is unavailable for memory extraction.");
  }
  signal.throwIfAborted();
  if (runtime.getError()) throw new Error("Pi model configuration is unavailable for memory extraction.");
  const model = runtime.getModel(selection.provider, selection.model);
  if (!model) throw new Error("The selected memory extraction model is not in the Pi catalog.");
  if (model.api !== "openai-completions") {
    throw new Error("Memory extraction currently requires an explicit OpenAI Chat Completions model.");
  }
  if (runtime.getRegisteredProviderConfig(model.provider)?.streamSimple) {
    throw new Error("Custom Pi provider execution cannot be delegated to the local memory runtime.");
  }
  if (runtime.isUsingOAuth(model.provider) || runtime.isUsingSubscription(model.provider)) {
    throw new Error("OAuth or subscription credentials cannot be delegated to the local memory runtime.");
  }
  // Resolve endpoint and credentials together through the same authoritative Pi
  // model. Do not discard provider-specific request requirements to make it work.
  let resolved;
  try { resolved = await runtime.getAuth(model, { signal }); }
  catch {
    signal.throwIfAborted();
    throw new Error("Pi could not resolve memory extraction credentials.");
  }
  signal.throwIfAborted();
  if (!resolved?.auth.apiKey?.trim()) throw new Error("Memory extraction requires a configured API key.");
  if (Object.keys(resolved.auth.headers ?? {}).length || Object.keys(model.headers ?? {}).length
    || Object.keys(resolved.env ?? {}).length) {
    throw new Error("This memory adapter cannot preserve the selected model's headers or provider environment.");
  }
  const endpoint = resolved.auth.baseUrl ?? model.baseUrl;
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { throw new Error("Invalid memory extraction endpoint."); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.protocol !== "https:" && !(parsed.protocol === "http:"
      && ["127.0.0.1", "[::1]"].includes(parsed.hostname)))) {
    throw new Error("Memory extraction requires HTTPS or an exact loopback endpoint.");
  }
  return { protocol: "openai-compatible", endpoint, model: model.id, apiKey: resolved.auth.apiKey };
}
