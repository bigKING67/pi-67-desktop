import {
  activeSessionProjectionAuthorityWithoutConnection,
  matchesSessionProjectionAuthority,
  type SessionProjectionAuthority,
  type SessionProjectionAuthorityState
} from "./session-projection-authority.js";

export type SessionProjectionGroup =
  | "identity"
  | "modelCatalog"
  | "controls"
  | "interaction"
  | "queue"
  | "resources"
  | "usage";

export interface SessionProjectionRevisions {
  identity: number;
  modelCatalog: number;
  controls: number;
  interaction: number;
  queue: number;
  resources: number;
  usage: number;
}

export interface SessionProjectionTarget extends SessionProjectionAuthority {
  revisions: SessionProjectionRevisions;
}

export const INITIAL_SESSION_PROJECTION_REVISIONS: SessionProjectionRevisions = {
  identity: 0,
  modelCatalog: 0,
  controls: 0,
  interaction: 0,
  queue: 0,
  resources: 0,
  usage: 0
};

export function incrementSessionProjectionRevision(
  revisions: SessionProjectionRevisions,
  group: SessionProjectionGroup
): SessionProjectionRevisions {
  return { ...revisions, [group]: revisions[group] + 1 };
}

export function incrementAllSessionProjectionRevisions(
  revisions: SessionProjectionRevisions
): SessionProjectionRevisions {
  return {
    identity: revisions.identity + 1,
    modelCatalog: revisions.modelCatalog + 1,
    controls: revisions.controls + 1,
    interaction: revisions.interaction + 1,
    queue: revisions.queue + 1,
    resources: revisions.resources + 1,
    usage: revisions.usage + 1
  };
}

export function canApplySessionProjectionTarget(
  authority: SessionProjectionAuthorityState,
  target: SessionProjectionTarget,
  sessionId: string
): boolean {
  return sessionId === target.sessionId
    && matchesSessionProjectionAuthority(
      activeSessionProjectionAuthorityWithoutConnection(authority),
      target
    );
}
