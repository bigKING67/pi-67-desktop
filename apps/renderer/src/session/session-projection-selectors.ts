import type { ModelSummary, ProviderSummary } from "@pi67/domain";
import type { SessionProjectionState } from "./session-projection-state.js";

export interface SessionModelProviderGroup {
  id: string;
  label: string;
  models: readonly ModelSummary[];
}

export const selectSessionId = (state: SessionProjectionState) => (
  state.authority.phase === "inactive" ? undefined : state.authority.sessionId
);
export const selectSessionGeneration = (state: SessionProjectionState) => (
  state.authority.phase === "active" ? state.authority.sessionGeneration : undefined
);
export const selectHasSession = (state: SessionProjectionState) => (
  state.authority.phase !== "inactive"
);
export const selectSessionPath = (state: SessionProjectionState) => state.identity?.sessionPath;
export const selectSessionFileIdentity = (state: SessionProjectionState) => state.identity?.sessionFileIdentity;
export const selectSessionName = (state: SessionProjectionState) => state.identity?.sessionName;
export const selectSessionModels = (state: SessionProjectionState) => state.modelCatalog?.models;
export const selectSessionModelProviders = (state: SessionProjectionState) => state.modelCatalog?.providers;
export const selectSelectedModel = (state: SessionProjectionState) => state.controls?.selectedModel;
export const selectThinkingLevel = (state: SessionProjectionState) => state.controls?.thinkingLevel;
export const selectAvailableThinkingLevels = (state: SessionProjectionState) => (
  state.modelCatalog?.availableThinkingLevels
);
export const selectSteeringQueue = (state: SessionProjectionState) => state.queue?.steeringQueue;
export const selectFollowUpQueue = (state: SessionProjectionState) => state.queue?.followUpQueue;
export const selectSessionStats = (state: SessionProjectionState) => state.usage;
export const selectSessionResources = (state: SessionProjectionState) => state.resources;
export const selectInteractionMode = (state: SessionProjectionState) => (
  state.interaction?.interactionMode ?? "execute"
);
export const selectActiveProposedPlan = (state: SessionProjectionState) => (
  state.interaction?.activeProposedPlan
);
export const selectPlanLifecycle = (state: SessionProjectionState) => (
  state.interaction?.planLifecycle
);

export function groupVisibleSessionModelsByProvider(
  models: readonly ModelSummary[] | undefined,
  providers: readonly ProviderSummary[] | undefined,
  selectedModel: { provider: string; id: string } | undefined
): SessionModelProviderGroup[] {
  const selectedKey = selectedModel ? `${selectedModel.provider}/${selectedModel.id}` : undefined;
  const visibleModels = models?.filter((model) => (
    model.configured || `${model.provider}/${model.id}` === selectedKey
  )) ?? [];
  const modelsByProvider = new Map<string, ModelSummary[]>();

  for (const model of visibleModels) {
    const group = modelsByProvider.get(model.provider);
    if (group) group.push(model);
    else modelsByProvider.set(model.provider, [model]);
  }

  const groups: SessionModelProviderGroup[] = [];
  const projectedProviderIds = new Set<string>();
  for (const provider of providers ?? []) {
    if (projectedProviderIds.has(provider.id)) continue;
    projectedProviderIds.add(provider.id);
    const group = modelsByProvider.get(provider.id);
    if (group) groups.push({ id: provider.id, label: provider.label, models: group });
  }

  // Preserve runtime order for any model whose projected Provider is unavailable.
  for (const [id, group] of modelsByProvider) {
    if (!projectedProviderIds.has(id)) groups.push({ id, label: id, models: group });
  }
  return groups;
}
