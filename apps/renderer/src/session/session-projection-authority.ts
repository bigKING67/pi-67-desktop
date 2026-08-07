export interface SessionProjectionConnection {
  connected: boolean;
  hostEpoch: number | undefined;
}

export interface SessionProjectionAuthority {
  hostEpoch: number;
  sessionId: string;
  sessionFileIdentity: string;
  sessionGeneration: number;
  projectionRevision: number;
}

export type FeatureProjectionAuthority = SessionProjectionAuthority;

export type SessionProjectionAuthorityState =
  | { phase: "inactive"; projectionRevision: number }
  | {
      phase: "active";
      hostEpoch: number;
      sessionId: string;
      sessionFileIdentity: string;
      sessionGeneration: number;
      projectionRevision: number;
    };

export interface SessionProjectionTransitionTarget {
  hostEpoch: number;
  projectionRevision: number;
}

export interface SessionProjectionInstallation extends SessionProjectionAuthority {
  baseProjectionRevision: number;
}

export function activeSessionProjectionAuthority(
  authority: SessionProjectionAuthorityState,
  connection: SessionProjectionConnection
): SessionProjectionAuthority | undefined {
  return connection.connected
    && connection.hostEpoch !== undefined
    && authority.phase === "active"
    && authority.hostEpoch === connection.hostEpoch
      ? activeSessionProjectionAuthorityWithoutConnection(authority)
      : undefined;
}

export function activeSessionProjectionAuthorityWithoutConnection(
  authority: SessionProjectionAuthorityState
): SessionProjectionAuthority | undefined {
  if (authority.phase !== "active") return undefined;
  return {
    hostEpoch: authority.hostEpoch,
    sessionId: authority.sessionId,
    sessionFileIdentity: authority.sessionFileIdentity,
    sessionGeneration: authority.sessionGeneration,
    projectionRevision: authority.projectionRevision
  };
}

export function isCurrentSessionProjectionInstallation(
  authority: SessionProjectionAuthorityState,
  connection: SessionProjectionConnection,
  installation: SessionProjectionInstallation
): boolean {
  return connection.connected
    && connection.hostEpoch === installation.hostEpoch
    && authority.phase === "inactive"
    && authority.projectionRevision === installation.projectionRevision;
}

export function matchesSessionProjectionAuthority(
  current: SessionProjectionAuthority | undefined,
  incoming: SessionProjectionAuthority
): boolean {
  return current !== undefined
    && current.hostEpoch === incoming.hostEpoch
    && current.sessionId === incoming.sessionId
    && current.sessionFileIdentity === incoming.sessionFileIdentity
    && current.sessionGeneration === incoming.sessionGeneration
    && current.projectionRevision === incoming.projectionRevision;
}

export function featureProjectionAuthorityFromInstallation(
  installation: SessionProjectionInstallation
): FeatureProjectionAuthority {
  return {
    hostEpoch: installation.hostEpoch,
    sessionId: installation.sessionId,
    sessionFileIdentity: installation.sessionFileIdentity,
    sessionGeneration: installation.sessionGeneration,
    projectionRevision: installation.projectionRevision
  };
}

export function matchesCommittedSessionProjection(
  featureAuthority: FeatureProjectionAuthority | undefined,
  canonicalAuthority: SessionProjectionAuthorityState
): boolean {
  return featureAuthority !== undefined
    && matchesSessionProjectionAuthority(
      activeSessionProjectionAuthorityWithoutConnection(canonicalAuthority),
      featureAuthority
    );
}
