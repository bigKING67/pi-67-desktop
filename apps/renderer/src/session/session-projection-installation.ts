import type { SessionSnapshot } from "@pi67/domain";
import {
  activeSessionProjectionAuthority,
  isCurrentSessionProjectionInstallation,
  matchesSessionProjectionAuthority,
  type SessionProjectionAuthority,
  type SessionProjectionConnection,
  type SessionProjectionInstallation,
  type SessionProjectionTransitionTarget
} from "./session-projection-authority.js";
import { incrementAllSessionProjectionRevisions } from "./session-projection-revisions.js";
import {
  controlProjectionFromSnapshot,
  identityProjectionFromSnapshot,
  modelCatalogProjectionFromSnapshot,
  queueProjectionFromSnapshot
} from "./session-projection-snapshot.js";
import type {
  SessionProjectionData,
  SessionProjectionResetOptions
} from "./session-projection-state.js";

interface SnapshotReplacementStart {
  installation: SessionProjectionInstallation;
  patch: Partial<SessionProjectionData>;
}

interface SnapshotReplacementCommit {
  authority: SessionProjectionAuthority;
  patch: Partial<SessionProjectionData>;
}

export function beginSessionSnapshotReplacement(
  state: SessionProjectionData,
  connection: SessionProjectionConnection,
  snapshot: SessionSnapshot,
  sessionGeneration?: number,
  transitionTarget?: SessionProjectionTransitionTarget
): SnapshotReplacementStart | undefined {
  if (!connection.connected || connection.hostEpoch === undefined) return undefined;
  if (
    transitionTarget !== undefined
    && (
      transitionTarget.hostEpoch !== connection.hostEpoch
      || transitionTarget.projectionRevision !== state.authority.projectionRevision
    )
  ) return undefined;
  const current = state.authority;
  const canReuseGeneration = current.phase === "active"
    && current.hostEpoch === connection.hostEpoch
    && current.sessionId === snapshot.sessionId;
  const resolvedGeneration = sessionGeneration
    ?? (canReuseGeneration ? current.sessionGeneration : undefined);
  if (resolvedGeneration === undefined) return undefined;
  const projectionRevision = current.projectionRevision + 1;
  const installation: SessionProjectionInstallation = {
    hostEpoch: connection.hostEpoch,
    sessionId: snapshot.sessionId,
    sessionGeneration: resolvedGeneration,
    projectionRevision,
    baseProjectionRevision: current.projectionRevision
  };
  return {
    installation,
    patch: {
      authority: { phase: "inactive", projectionRevision },
      identity: undefined,
      modelCatalog: undefined,
      controls: undefined,
      queue: undefined,
      resources: undefined,
      usage: undefined,
      revisions: incrementAllSessionProjectionRevisions(state.revisions)
    }
  };
}

export function commitSessionSnapshotReplacement(
  state: SessionProjectionData,
  connection: SessionProjectionConnection,
  installation: SessionProjectionInstallation,
  snapshot: SessionSnapshot
): SnapshotReplacementCommit | undefined {
  if (
    snapshot.sessionId !== installation.sessionId
    || !isCurrentSessionProjectionInstallation(state.authority, connection, installation)
  ) return undefined;
  const authority: SessionProjectionAuthority = {
    hostEpoch: installation.hostEpoch,
    sessionId: installation.sessionId,
    sessionGeneration: installation.sessionGeneration,
    projectionRevision: installation.projectionRevision
  };
  return {
    authority,
    patch: {
      authority: { phase: "active", ...authority },
      identity: identityProjectionFromSnapshot(snapshot),
      modelCatalog: modelCatalogProjectionFromSnapshot(snapshot),
      controls: controlProjectionFromSnapshot(snapshot),
      queue: queueProjectionFromSnapshot(snapshot),
      resources: snapshot.resources,
      usage: snapshot.stats,
      recoverySessionPath: snapshot.sessionPath,
      revisions: incrementAllSessionProjectionRevisions(state.revisions)
    }
  };
}

export function resetSessionProjection(
  state: SessionProjectionData,
  options?: SessionProjectionResetOptions
): Partial<SessionProjectionData> {
  return {
    authority: {
      phase: "inactive",
      projectionRevision: state.authority.projectionRevision + 1
    },
    identity: undefined,
    modelCatalog: undefined,
    controls: undefined,
    queue: undefined,
    resources: undefined,
    usage: undefined,
    recoverySessionPath: options?.preserveRecoverySessionPath
      ? state.recoverySessionPath
      : undefined,
    revisions: incrementAllSessionProjectionRevisions(state.revisions)
  };
}

export function isCommittedSessionSnapshotAuthority(
  state: SessionProjectionData,
  connection: SessionProjectionConnection,
  authority: SessionProjectionAuthority
): boolean {
  return matchesSessionProjectionAuthority(
    activeSessionProjectionAuthority(state.authority, connection),
    authority
  );
}
