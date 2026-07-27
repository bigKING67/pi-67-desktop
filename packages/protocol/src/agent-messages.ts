import type {
  ApprovalRequestView,
  ApprovalMode,
  ConversationPage,
  DoctorReport,
  ExtensionCatalogResult,
  ExtensionCommandAdapterView,
  ExtensionCompatibilityEventView,
  ExtensionUiCancellationReason,
  ExtensionUiRequestView,
  ModelSummary,
  OperationActivity,
  OperationKind,
  OperationView,
  ResourceSummary,
  RuntimeCapabilities,
  RuntimeStatus,
  SessionCatalogChangedEvent,
  SessionCatalogPage,
  SessionCatalogQuery,
  SessionCatalogStatus,
  SessionControlResult,
  SessionModelCatalogResult,
  SessionResourceCatalogResult,
  SessionSnapshot,
  SessionTreeProjection,
  WorkspaceChangesProjection,
  WorkspaceChangeView,
  WorkspaceTrust
} from "@pi67/domain";

export type ProtocolErrorCode =
  | "PROTOCOL_MISMATCH"
  | "INVALID_PAYLOAD"
  | "CONNECTION_CLOSED"
  | "REQUEST_TIMEOUT"
  | "STALE_HOST_EPOCH"
  | "STALE_SESSION_GENERATION"
  | "STALE_OPERATION"
  | "STALE_SESSION_CATALOG"
  | "DUPLICATE_REQUEST"
  | "BUSY"
  | "OPERATION_NOT_FOUND"
  | "SESSION_CHANGED_EXTERNALLY"
  | "RUNTIME_NOT_READY"
  | "RUNTIME_POISONED"
  | "MODEL_NOT_FOUND"
  | "WORKSPACE_NOT_TRUSTED"
  | "PATH_OUTSIDE_WORKSPACE"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "UNSUPPORTED"
  | "INTERNAL";

export interface ProtocolError {
  code: ProtocolErrorCode;
  message: string;
  recoverable: boolean;
  retryAfterMs?: number;
  details?: Record<string, string | number | boolean>;
}

export class ProtocolRequestError extends Error {
  readonly code: ProtocolErrorCode;
  readonly recoverable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly details: Record<string, string | number | boolean> | undefined;

  constructor(error: ProtocolError) {
    super(error.message);
    this.name = "ProtocolRequestError";
    this.code = error.code;
    this.recoverable = error.recoverable;
    this.retryAfterMs = error.retryAfterMs;
    this.details = error.details;
  }
}

export interface TransferImage {
  name: string;
  mimeType: string;
  data: ArrayBuffer;
}

export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_TRANSFER_IMAGE_COUNT = 8;
export const MAX_TRANSFER_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TRANSFER_IMAGE_TOTAL_BYTES = 30 * 1024 * 1024;

export type PromptDelivery = "new-turn" | "steer" | "follow-up";

export interface PromptSubmitRequest {
  submissionId: string;
  text: string;
  images?: TransferImage[];
  delivery: PromptDelivery;
}

export interface OperationAccepted {
  kind: "accepted";
  operationId: string;
  cancellable: boolean;
  hostEpoch: number;
  sessionId: string;
  sessionGeneration: number;
}

interface OperationSettledBase {
  kind: "settled";
  operationId: string;
  operationKind: OperationKind;
  cancellable: false;
  hostEpoch: number;
  sessionId: string;
  sessionGeneration: number;
  startedAt: number;
  settledAt: number;
}

export type OperationSettled = OperationSettledBase & (
  | { lifecycle: "completed" }
  | { lifecycle: "failed"; error: ProtocolError }
  | { lifecycle: "cancelled" | "lost"; reason: string }
);

export type OperationSubmissionResult = OperationAccepted | OperationSettled;

export function isOperationSettled(result: OperationSubmissionResult): result is OperationSettled {
  return result.kind === "settled";
}

export interface Acknowledgement {
  accepted: true;
}

export interface ProjectionMutationAcknowledgement extends Acknowledgement {
  hostEpoch: number;
  sessionId: string;
  sessionGeneration: number;
  eventSequence: number;
}

export interface RuntimeStatusResult {
  initialized: boolean;
  loaded: boolean;
}

export interface AssetReadResult {
  assetId: string;
  mimeType: string;
  byteLength: number;
  offset: number;
  data: ArrayBuffer;
  done: boolean;
}

export interface ProjectionResyncResult {
  snapshot: SessionSnapshot;
  changes: WorkspaceChangesProjection;
  extensionCatalog: ExtensionCatalogResult;
  sessionCatalogStatus: SessionCatalogStatus;
  eventSequence: number;
  hostEpoch: number;
  sessionGeneration: number;
  activeOperation?: OperationView;
  latestOperationTerminal?: OperationSettled;
}

export interface RuntimeDiagnostics {
  application: string;
  piSdkVersion: string;
  platform: string;
  architecture: string;
  node: string;
  cwd?: string;
  sessionConfigured: boolean;
  sessionFileConfigured: boolean;
  model?: string;
  extensionCount: number;
  extensionErrors: Array<{ path: string; error: string }>;
}

export interface CommandDescriptor {
  name: string;
  description?: string;
  adapter?: ExtensionCommandAdapterView;
}

export interface QueueClearResult {
  steeringCount: number;
  followUpCount: number;
  pendingCount: number;
}

export interface CommandPayloads {
  "runtime.initialize": {
    cwd: string;
    agentDir?: string;
    sessionPath?: string;
    trust: WorkspaceTrust;
    approvalMode: ApprovalMode;
  };
  "runtime.getStatus": Record<string, never>;
  "projection.resync": Record<string, never>;
  "asset.read": { assetId: string; sessionGeneration: number; offset: number; length?: number };
  "workspace.open": { cwd: string; trust: WorkspaceTrust; approvalMode: ApprovalMode };
  "workspace.setTrust": { trust: WorkspaceTrust; approvalMode: ApprovalMode };
  "workspace.changes": Record<string, never>;
  "session.catalog.query": SessionCatalogQuery;
  "session.tree": Record<string, never>;
  "message.page": { direction: "older" | "newer"; cursor?: string; limit?: number };
  "session.create": Record<string, never>;
  "session.open": { path: string; cwdOverride?: string };
  "session.import": { submissionId: string; path: string };
  "session.fork": { entryId: string };
  "session.rollback": { entryId: string; summarize?: boolean };
  "session.compact": { submissionId: string; instructions?: string };
  "session.name": { name: string };
  "prompt.submit": PromptSubmitRequest;
  "prompt.steer": { text: string; images?: TransferImage[] };
  "prompt.followUp": { text: string; images?: TransferImage[] };
  "queue.clear": Record<string, never>;
  "operation.abort": { operationId?: string };
  "model.list": Record<string, never>;
  "model.select": { provider: string; id: string };
  "model.setRuntimeKey": { provider: string; apiKey: string };
  "thinking.set": { level: string };
  "resource.list": Record<string, never>;
  "resource.reload": Record<string, never>;
  "command.list": Record<string, never>;
  "command.invoke": { submissionId: string; command: string };
  "extension.catalog.list": Record<string, never>;
  "extension.ui.respond": {
    requestId: string;
    sessionId: string;
    sessionGeneration: number;
    operationId?: string;
    value?: string | boolean;
    cancelled?: boolean;
  };
  "approval.respond": {
    requestId: string;
    toolCallId: string;
    sessionId: string;
    sessionGeneration: number;
    operationId: string;
    allowed: boolean;
  };
  "diagnostics.collect": Record<string, never>;
  "doctor.run": Record<string, never>;
}

export interface CommandResults {
  "runtime.initialize": ProjectionMutationAcknowledgement;
  "runtime.getStatus": RuntimeStatusResult;
  "projection.resync": ProjectionResyncResult;
  "asset.read": AssetReadResult;
  "workspace.open": ProjectionMutationAcknowledgement;
  "workspace.setTrust": SessionResourceCatalogResult;
  "workspace.changes": WorkspaceChangesProjection;
  "session.catalog.query": SessionCatalogPage;
  "session.tree": SessionTreeProjection;
  "message.page": ConversationPage;
  "session.create": ProjectionMutationAcknowledgement;
  "session.open": ProjectionMutationAcknowledgement;
  "session.import": OperationSubmissionResult;
  "session.fork": ProjectionMutationAcknowledgement;
  "session.rollback": ProjectionMutationAcknowledgement;
  "session.compact": OperationSubmissionResult;
  "session.name": ProjectionMutationAcknowledgement;
  "prompt.submit": OperationSubmissionResult;
  "prompt.steer": Acknowledgement;
  "prompt.followUp": Acknowledgement;
  "queue.clear": QueueClearResult;
  "operation.abort": { aborted: boolean; operationId?: string };
  "model.list": ModelSummary[];
  "model.select": SessionControlResult;
  "model.setRuntimeKey": SessionModelCatalogResult;
  "thinking.set": SessionControlResult;
  "resource.list": ResourceSummary[];
  "resource.reload": SessionResourceCatalogResult;
  "command.list": CommandDescriptor[];
  "command.invoke": OperationSubmissionResult;
  "extension.catalog.list": ExtensionCatalogResult;
  "extension.ui.respond": { resolved: boolean };
  "approval.respond": { resolved: boolean };
  "diagnostics.collect": RuntimeDiagnostics;
  "doctor.run": DoctorReport;
}

export type AgentCommandType = keyof CommandPayloads;

export const REPLAY_SAFE_CONTROL_MUTATION_TYPES = [
  "runtime.initialize",
  "workspace.open",
  "workspace.setTrust",
  "session.create",
  "session.open",
  "session.fork",
  "session.rollback",
  "session.name",
  "model.select",
  "model.setRuntimeKey",
  "thinking.set",
  "resource.reload"
] as const satisfies readonly AgentCommandType[];

export type ReplaySafeControlMutationType = typeof REPLAY_SAFE_CONTROL_MUTATION_TYPES[number];

const REPLAY_SAFE_CONTROL_MUTATIONS = new Set<AgentCommandType>(REPLAY_SAFE_CONTROL_MUTATION_TYPES);

export function isReplaySafeControlMutation(
  type: AgentCommandType
): type is ReplaySafeControlMutationType {
  return REPLAY_SAFE_CONTROL_MUTATIONS.has(type);
}

export const REPLAY_SAFE_OPERATION_ACK_TYPES = [
  "session.import",
  "session.compact",
  "command.invoke"
] as const satisfies readonly AgentCommandType[];

export type ReplaySafeOperationAckType = typeof REPLAY_SAFE_OPERATION_ACK_TYPES[number];

const REPLAY_SAFE_OPERATION_ACKS = new Set<AgentCommandType>(REPLAY_SAFE_OPERATION_ACK_TYPES);

export function isReplaySafeOperationAck(
  type: AgentCommandType
): type is ReplaySafeOperationAckType {
  return REPLAY_SAFE_OPERATION_ACKS.has(type);
}

export type AgentCommand<T extends AgentCommandType = AgentCommandType> = {
  [K in T]: { type: K; payload: CommandPayloads[K] };
}[T];

export interface StreamDelta {
  assistantMessageEvent: {
    type: "text_delta" | "thinking_delta";
    delta: string;
  };
}

export interface EventPayloads {
  "runtime.statusChanged": RuntimeStatus;
  "runtime.ready": { capabilities: RuntimeCapabilities; snapshot: SessionSnapshot };
  "runtime.crashed": { detail: string; recoverable: boolean };
  "session.bootstrap": {
    snapshot: SessionSnapshot;
    reason: "session-create" | "session-open" | "session-fork" | "session-import";
  };
  "conversation.changed": { sessionId: string; reason: "settled" | "compacted" | "rolled-back" };
  "queue.changed": { steeringQueue: string[]; followUpQueue: string[] };
  "session.metaChanged": {
    streaming: boolean;
    sessionName?: string;
    thinkingLevel: string;
    selectedModel?: { provider: string; id: string };
  };
  "tree.changed": { reason: "session-entry" | "compacted" | "rollback" };
  "usage.changed": { tokens: number; cost: number; contextPercent?: number };
  "session.catalog.changed": SessionCatalogChangedEvent;
  "session.externalChangeDetected": {
    reason: "appended" | "truncated" | "replaced" | "unavailable" | "invalid";
    recoverable: boolean;
  };
  "turn.streamBatch": { events: StreamDelta[] };
  "operation.started": { operation: OperationView };
  "operation.heartbeat": { operationId: string; observedAt: number; lastActivityAt: number };
  "operation.activityChanged": { operationId: string; activity: OperationActivity | null };
  "operation.progress": { operationId: string; message: string; current?: number; total?: number };
  "operation.completed": { operationId: string; completedAt: number };
  "operation.failed": { operationId: string; failedAt: number; error: ProtocolError };
  "operation.cancelled": { operationId: string; cancelledAt: number; reason: string };
  "operation.lost": { operationId: string; lostAt: number; reason: string };
  "workspace.changeChanged": { sessionId: string; change: WorkspaceChangeView };
  "approval.requested": ApprovalRequestView;
  "approval.resolved": { requestId: string; toolCallId: string; allowed: boolean };
  "approval.cancelled": {
    requests: Array<{ requestId: string; toolCallId: string }>;
    reason: ExtensionUiCancellationReason;
  };
  "extension.ui.requested": ExtensionUiRequestView;
  "extension.ui.updated": ExtensionUiRequestView;
  "extension.ui.resolved": { requestId: string; cancelled: boolean };
  "extension.ui.cancelled": { requestIds: string[]; reason: ExtensionUiCancellationReason };
  "extension.compatibilityChanged": ExtensionCompatibilityEventView;
  "extension.catalog.changed": ExtensionCatalogResult;
  "resource.changed": { reason: string };
  "diagnostics.progress": { step: string; completed: boolean };
  "doctor.completed": DoctorReport;
}

export type AgentEventType = keyof EventPayloads;

export type AgentEvent<T extends AgentEventType = AgentEventType> = {
  [K in T]: { type: K; payload: EventPayloads[K] };
}[T];

export type SuccessCommandResponse<T extends AgentCommandType = AgentCommandType> = {
  [K in T]: { ok: true; type: K; result: CommandResults[K] };
}[T];

export interface ErrorCommandResponse<T extends AgentCommandType = AgentCommandType> {
  ok: false;
  type: T;
  error: ProtocolError;
}

export type CommandResponse<T extends AgentCommandType = AgentCommandType> =
  | SuccessCommandResponse<T>
  | ErrorCommandResponse<T>;
