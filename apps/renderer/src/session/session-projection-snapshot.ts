import type {
  ActiveProposedPlan,
  PlanLifecycleChange,
  SessionControlsView,
  SessionInteractionMode,
  SessionModelCatalogView,
  SessionSnapshot
} from "@pi67/domain";

export interface SessionIdentityProjection {
  sessionFileIdentity: string | undefined;
  sessionPath: string | undefined;
  sessionName: string | undefined;
  cwd: string;
}

export type SessionControlProjection = SessionControlsView;
export type SessionModelCatalogProjection = SessionModelCatalogView;

export interface SessionQueueProjection {
  steeringQueue: string[];
  followUpQueue: string[];
}

export interface SessionInteractionProjection {
  interactionMode: SessionInteractionMode;
  activeProposedPlan?: ActiveProposedPlan;
  planLifecycle?: PlanLifecycleChange;
}

export function identityProjectionFromSnapshot(
  snapshot: SessionSnapshot
): SessionIdentityProjection {
  return {
    sessionFileIdentity: snapshot.sessionFileIdentity,
    sessionPath: snapshot.sessionPath,
    sessionName: snapshot.sessionName,
    cwd: snapshot.cwd
  };
}

export function controlProjectionFromSnapshot(
  snapshot: SessionSnapshot
): SessionControlProjection {
  return {
    ...(snapshot.selectedModel === undefined ? {} : { selectedModel: snapshot.selectedModel }),
    thinkingLevel: snapshot.thinkingLevel
  };
}

export function modelCatalogProjectionFromSnapshot(
  snapshot: SessionSnapshot
): SessionModelCatalogProjection {
  return {
    models: snapshot.models,
    providers: snapshot.providers,
    availableThinkingLevels: snapshot.availableThinkingLevels
  };
}

export function queueProjectionFromSnapshot(
  snapshot: SessionSnapshot
): SessionQueueProjection {
  return {
    steeringQueue: snapshot.steeringQueue,
    followUpQueue: snapshot.followUpQueue
  };
}

export function interactionProjectionFromSnapshot(
  snapshot: SessionSnapshot
): SessionInteractionProjection {
  return {
    interactionMode: snapshot.interactionMode ?? "execute",
    ...(snapshot.activeProposedPlan === undefined
      ? {}
      : { activeProposedPlan: snapshot.activeProposedPlan }),
    ...(snapshot.planLifecycle === undefined
      ? {}
      : { planLifecycle: snapshot.planLifecycle })
  };
}
