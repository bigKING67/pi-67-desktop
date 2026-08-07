import type { SessionProjectionState } from "./session-projection-state.js";

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
export const selectSelectedModel = (state: SessionProjectionState) => state.controls?.selectedModel;
export const selectThinkingLevel = (state: SessionProjectionState) => state.controls?.thinkingLevel;
export const selectAvailableThinkingLevels = (state: SessionProjectionState) => (
  state.modelCatalog?.availableThinkingLevels
);
export const selectSteeringQueue = (state: SessionProjectionState) => state.queue?.steeringQueue;
export const selectFollowUpQueue = (state: SessionProjectionState) => state.queue?.followUpQueue;
export const selectSessionStats = (state: SessionProjectionState) => state.usage;
export const selectSessionResources = (state: SessionProjectionState) => state.resources;
