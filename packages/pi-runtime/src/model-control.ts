import type { AgentSession, AgentSessionServices } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";

export async function selectSessionModel(
  session: AgentSession,
  provider: string,
  id: string
): Promise<void> {
  const model = session.modelRuntime.getModel(provider, id);
  if (!model) {
    throw new RuntimeError("MODEL_NOT_FOUND", "The selected Pi model is not available.", {
      details: { provider, modelId: id }
    });
  }
  await session.setModel(model);
}

export async function configureRuntimeApiKey(
  session: AgentSession,
  runtimeApiKeys: Map<string, string>,
  provider: string,
  apiKey: string
): Promise<void> {
  const normalizedProvider = provider.trim();
  const normalizedKey = apiKey.trim();
  if (!normalizedProvider || normalizedKey.length < 8) {
    throw new RuntimeError("INVALID_PAYLOAD", "Provider and API key are required.");
  }
  try {
    await session.modelRuntime.setRuntimeApiKey(normalizedProvider, normalizedKey, {
      allowNetwork: false
    });
    runtimeApiKeys.set(normalizedProvider, normalizedKey);
  } catch {
    // Provider errors may include credential material and must not cross into UI events.
    throw new RuntimeError(
      "INVALID_PAYLOAD",
      "Unable to configure the runtime API key for this provider."
    );
  }
}

export function setSessionThinkingLevel(session: AgentSession, level: string): void {
  const selectedLevel = session.getAvailableThinkingLevels().find((candidate) => candidate === level);
  if (!selectedLevel) {
    throw new RuntimeError("UNSUPPORTED", "The selected thinking level is not supported by this model.", {
      details: { feature: "thinking-level" }
    });
  }
  session.setThinkingLevel(selectedLevel);
}

export async function restoreRuntimeApiKeys(
  services: AgentSessionServices,
  runtimeApiKeys: ReadonlyMap<string, string>
): Promise<void> {
  for (const [provider, apiKey] of runtimeApiKeys) {
    await services.modelRuntime.setRuntimeApiKey(provider, apiKey, { allowNetwork: false });
  }
}
