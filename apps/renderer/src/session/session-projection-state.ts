import type {
  ResourceSummary,
  SessionControlResult,
  SessionModelCatalogResult,
  SessionResourceCatalogResult,
  SessionSnapshot
} from "@pi67/domain";
import type { EventEnvelope } from "@pi67/protocol";
import type {
  SessionProjectionAuthority,
  SessionProjectionAuthorityState,
  SessionProjectionConnection,
  SessionProjectionInstallation,
  SessionProjectionTransitionTarget
} from "./session-projection-authority.js";
import type {
  SessionProjectionGroup,
  SessionProjectionRevisions,
  SessionProjectionTarget
} from "./session-projection-revisions.js";
import type {
  SessionControlProjection,
  SessionIdentityProjection,
  SessionModelCatalogProjection,
  SessionQueueProjection
} from "./session-projection-snapshot.js";

export interface SessionMetaUpdate {
  sessionName: string | undefined;
  selectedModel: SessionSnapshot["selectedModel"];
  thinkingLevel: string;
}

export interface SessionUsageUpdate {
  tokens: number;
  cost: number;
  contextPercent?: number;
}

export interface SessionProjectionResetOptions {
  preserveRecoverySessionPath?: boolean;
}

export interface SessionProjectionData {
  authority: SessionProjectionAuthorityState;
  identity: SessionIdentityProjection | undefined;
  modelCatalog: SessionModelCatalogProjection | undefined;
  controls: SessionControlProjection | undefined;
  queue: SessionQueueProjection | undefined;
  resources: ResourceSummary[] | undefined;
  usage: SessionSnapshot["stats"];
  recoverySessionPath: string | undefined;
  revisions: SessionProjectionRevisions;
}

export interface SessionProjectionState extends SessionProjectionData {
  currentAuthority: (
    connection: SessionProjectionConnection
  ) => SessionProjectionAuthority | undefined;
  captureTransition: (
    connection: SessionProjectionConnection
  ) => SessionProjectionTransitionTarget | undefined;
  acceptTransition: (
    connection: SessionProjectionConnection,
    target: SessionProjectionTransitionTarget
  ) => boolean;
  beginSnapshotReplacement: (
    connection: SessionProjectionConnection,
    snapshot: SessionSnapshot,
    sessionGeneration?: number,
    transitionTarget?: SessionProjectionTransitionTarget
  ) => SessionProjectionInstallation | undefined;
  isSnapshotReplacementCurrent: (
    connection: SessionProjectionConnection,
    installation: SessionProjectionInstallation
  ) => boolean;
  commitSnapshotReplacement: (
    connection: SessionProjectionConnection,
    installation: SessionProjectionInstallation,
    snapshot: SessionSnapshot
  ) => SessionProjectionAuthority | undefined;
  reset: (options?: SessionProjectionResetOptions) => void;
  acceptEvent: (
    connection: SessionProjectionConnection,
    envelope: EventEnvelope,
    payloadSessionId?: string
  ) => SessionProjectionAuthority | undefined;
  acceptResponse: (
    connection: SessionProjectionConnection,
    target: SessionProjectionAuthority
  ) => boolean;
  capture: (authority: SessionProjectionAuthority) => SessionProjectionTarget | undefined;
  applySnapshot: (
    target: SessionProjectionTarget,
    snapshot: SessionSnapshot,
    groups: readonly SessionProjectionGroup[]
  ) => boolean;
  applyControlResult: (
    target: SessionProjectionTarget,
    result: SessionControlResult
  ) => boolean;
  applyModelCatalogResult: (
    target: SessionProjectionTarget,
    result: SessionModelCatalogResult
  ) => boolean;
  applyResourceCatalogResult: (
    target: SessionProjectionTarget,
    result: SessionResourceCatalogResult
  ) => boolean;
  applyQueue: (
    authority: SessionProjectionAuthority,
    queue: SessionQueueProjection
  ) => boolean;
  applyMeta: (
    authority: SessionProjectionAuthority,
    update: SessionMetaUpdate
  ) => boolean;
  applyUsage: (
    authority: SessionProjectionAuthority,
    update: SessionUsageUpdate
  ) => boolean;
  clearQueue: (target: SessionProjectionTarget) => boolean;
}
