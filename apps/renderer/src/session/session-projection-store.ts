import { create } from "zustand";
import { eventSessionAuthority } from "../connection/event-authority.js";
import {
  activeSessionProjectionAuthority,
  activeSessionProjectionAuthorityWithoutConnection,
  isCurrentSessionProjectionInstallation,
  matchesSessionProjectionAuthority
} from "./session-projection-authority.js";
import {
  beginSessionSnapshotReplacement,
  commitSessionSnapshotReplacement,
  isCommittedSessionSnapshotAuthority,
  resetSessionProjection
} from "./session-projection-installation.js";
import {
  clearedSessionQueuePatch,
  sessionControlResultPatch,
  sessionMetaProjectionPatch,
  sessionInteractionModeProjectionPatch,
  sessionModelCatalogResultPatch,
  sessionQueueProjectionPatch,
  sessionResourceCatalogResultPatch,
  proposedPlanProjectionPatch,
  sessionSnapshotProjectionPatch,
  sessionUsageProjectionPatch
} from "./session-projection-mutations.js";
import {
  INITIAL_SESSION_PROJECTION_REVISIONS
} from "./session-projection-revisions.js";
import type { SessionProjectionState } from "./session-projection-state.js";

export type {
  FeatureProjectionAuthority,
  SessionProjectionAuthority,
  SessionProjectionAuthorityState,
  SessionProjectionConnection,
  SessionProjectionInstallation,
  SessionProjectionTransitionTarget
} from "./session-projection-authority.js";
export type { SessionProjectionState } from "./session-projection-state.js";

export const useSessionProjectionStore = create<SessionProjectionState>((set, get) => ({
  authority: { phase: "inactive", projectionRevision: 0 },
  identity: undefined,
  modelCatalog: undefined,
  controls: undefined,
  interaction: undefined,
  queue: undefined,
  resources: undefined,
  usage: undefined,
  compatibility: undefined,
  recoverySessionFileIdentity: undefined,
  recoverySessionPath: undefined,
  revisions: INITIAL_SESSION_PROJECTION_REVISIONS,

  currentAuthority(connection) {
    return activeSessionProjectionAuthority(get().authority, connection);
  },

  captureTransition(connection) {
    const authority = get().authority;
    return connection.connected && connection.hostEpoch !== undefined
      ? {
          hostEpoch: connection.hostEpoch,
          projectionRevision: authority.projectionRevision
        }
      : undefined;
  },

  acceptTransition(connection, target) {
    return connection.connected
      && connection.hostEpoch === target.hostEpoch
      && get().authority.projectionRevision === target.projectionRevision;
  },

  beginSnapshotReplacement(connection, snapshot, sessionGeneration, transitionTarget) {
    const change = beginSessionSnapshotReplacement(
      get(),
      connection,
      snapshot,
      sessionGeneration,
      transitionTarget
    );
    if (!change) return undefined;
    set(change.patch);
    return isCurrentSessionProjectionInstallation(get().authority, connection, change.installation)
      ? change.installation
      : undefined;
  },

  isSnapshotReplacementCurrent(connection, installation) {
    return isCurrentSessionProjectionInstallation(get().authority, connection, installation);
  },

  commitSnapshotReplacement(connection, installation, snapshot) {
    const change = commitSessionSnapshotReplacement(get(), connection, installation, snapshot);
    if (!change) return undefined;
    set(change.patch);
    return isCommittedSessionSnapshotAuthority(get(), connection, change.authority)
      ? change.authority
      : undefined;
  },

  reset(options) {
    set(resetSessionProjection(get(), options));
  },

  acceptEvent(connection, envelope, payloadSessionId) {
    const current = get().authority;
    const eventAuthority = eventSessionAuthority(envelope);
    const sessionGeneration = eventAuthority?.sessionGeneration;
    if (
      !connection.connected
      || connection.hostEpoch === undefined
      || current.phase !== "active"
      || current.hostEpoch !== connection.hostEpoch
      || envelope.hostEpoch !== current.hostEpoch
      || eventAuthority?.sessionId !== current.sessionId
      || eventAuthority?.sessionFileIdentity !== current.sessionFileIdentity
      || sessionGeneration === undefined
      || (payloadSessionId !== undefined && payloadSessionId !== current.sessionId)
      || current.sessionGeneration !== sessionGeneration
    ) return undefined;

    return {
      hostEpoch: current.hostEpoch,
      sessionId: current.sessionId,
      sessionFileIdentity: current.sessionFileIdentity,
      sessionGeneration,
      projectionRevision: current.projectionRevision
    };
  },

  acceptResponse(connection, target) {
    return matchesSessionProjectionAuthority(
      activeSessionProjectionAuthority(get().authority, connection),
      target
    );
  },

  capture(authority) {
    const state = get();
    return matchesSessionProjectionAuthority(
      activeSessionProjectionAuthorityWithoutConnection(state.authority),
      authority
    )
      ? { ...authority, revisions: state.revisions }
      : undefined;
  },

  applySnapshot(target, snapshot, groups) {
    return applyPatch(sessionSnapshotProjectionPatch(get(), target, snapshot, groups), set);
  },

  applyControlResult(target, result) {
    return applyPatch(sessionControlResultPatch(get(), target, result), set);
  },

  applyModelCatalogResult(target, result) {
    return applyPatch(sessionModelCatalogResultPatch(get(), target, result), set);
  },

  applyResourceCatalogResult(target, result) {
    return applyPatch(sessionResourceCatalogResultPatch(get(), target, result), set);
  },

  applyQueue(authority, queue) {
    return applyPatch(sessionQueueProjectionPatch(get(), authority, queue), set);
  },

  applyMeta(authority, update) {
    return applyPatch(sessionMetaProjectionPatch(get(), authority, update), set);
  },

  applyUsage(authority, update) {
    return applyPatch(sessionUsageProjectionPatch(get(), authority, update), set);
  },

  applyInteractionMode(authority, mode) {
    return applyPatch(sessionInteractionModeProjectionPatch(get(), authority, mode), set);
  },

  applyProposedPlan(authority, plan) {
    return applyPatch(proposedPlanProjectionPatch(get(), authority, plan), set);
  },

  clearQueue(target) {
    return applyPatch(clearedSessionQueuePatch(get(), target), set);
  }
}));

function applyPatch(
  patch: Partial<SessionProjectionState> | undefined,
  set: (patch: Partial<SessionProjectionState>) => void
): boolean {
  if (!patch) return false;
  set(patch);
  return true;
}
