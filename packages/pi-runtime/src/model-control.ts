import type { AgentSession, AgentSessionServices } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "@pi67/domain";

export async function selectSessionModel(
  session: AgentSession,
  provider: string,
  id: string
): Promise<void> {
  if (session.model?.provider === provider && session.model.id === id) return;
  const model = session.modelRuntime.getModel(provider, id);
  if (!model) {
    throw new RuntimeError("MODEL_NOT_FOUND", "The selected Pi model is not available.", {
      details: { provider, modelId: id }
    });
  }
  await session.setModel(model, { persist: true });
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
    await services.modelRuntime.setRuntimeApiKey(provider, apiKey);
  }
}
