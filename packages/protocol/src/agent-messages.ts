import type {
  ApprovalMode,
  ConversationPage,
  DoctorReport,
  ExtensionCatalogResult,
  ExtensionCommandAdapterView,
  ExtensionPackageListResult,
  ExtensionPackageMutationResult,
  ExtensionPackageScope,
  ExtensionPackageUpdatesResult,
  ModelSummary,
  OperationKind,
  OperationView,
  ProviderSummary,
  ResourceSummary,
  SessionCatalogPage,
  SessionCatalogQuery,
  SessionCatalogStatus,
  SessionSummary,
  SessionControlResult,
  SessionModelCatalogResult,
  SessionResourceCatalogResult,
  SessionSnapshot,
  SessionTreeProjection,
  WorkspaceChangesProjection,
  WorkspaceTrust
} from "@pi67/domain";
import type {
  PiProviderConfigurationInput,
  PiProviderConfigurationSnapshot
} from "./provider-configuration-schemas.js";
import type { ProtocolError } from "./protocol-error.js";

export { ProtocolRequestError } from "./protocol-error.js";
export type { ProtocolError, ProtocolErrorCode } from "./protocol-error.js";

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

export interface TaskCloseResult {
  closed: true;
  stopped: boolean;
}

export interface WorkspaceRegisterResult { registered: true; }
export interface WorkspaceUnregisterResult { unregistered: true; }

export type SessionCatalogResultItem = SessionSummary & { workspaceId?: string };
export type SessionCatalogPageResult = Omit<SessionCatalogPage, "items"> & {
  items: SessionCatalogResultItem[];
};

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
  "workspace.register": { cwd: string; trust: WorkspaceTrust; approvalMode: ApprovalMode };
  "workspace.unregister": Record<string, never>;
  "workspace.setTrust": { trust: WorkspaceTrust; approvalMode: ApprovalMode };
  "workspace.changes": Record<string, never>;
  "task.close": { mode: "stop" | "dispose" };
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
  "provider.list": Record<string, never>;
  "provider.setRuntimeKey": { provider: string; apiKey: string };
  "provider.configuration.get": Record<string, never>;
  "provider.configuration.save": {
    expectedRevision: string;
    provider: PiProviderConfigurationInput;
  };
  "provider.configuration.remove": { expectedRevision: string; provider: string };
  "provider.credential.store": { expectedRevision: string; provider: string; apiKey: string };
  "provider.credential.remove": { expectedRevision: string; provider: string };
  "model.default.set": {
    expectedRevision: string;
    scope: "global" | "project";
    provider?: string;
    model?: string;
  };
  "provider.configuration.reload": Record<string, never>;
  "thinking.set": { level: string };
  "resource.list": Record<string, never>;
  "resource.reload": Record<string, never>;
  "command.list": Record<string, never>;
  "command.invoke": { submissionId: string; command: string };
  "extension.catalog.list": Record<string, never>;
  "extension.package.list": Record<string, never>;
  "extension.package.checkUpdates": Record<string, never>;
  "extension.package.install": { source: string; scope: ExtensionPackageScope };
  "extension.package.update": { source: string; scope: ExtensionPackageScope };
  "extension.package.setEnabled": { source: string; scope: ExtensionPackageScope; enabled: boolean };
  "extension.package.restoreInheritance": { source: string };
  "extension.package.uninstall": { source: string; scope: ExtensionPackageScope };
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
  "workspace.register": WorkspaceRegisterResult;
  "workspace.unregister": WorkspaceUnregisterResult;
  "workspace.setTrust": SessionResourceCatalogResult;
  "workspace.changes": WorkspaceChangesProjection;
  "task.close": TaskCloseResult;
  "session.catalog.query": SessionCatalogPageResult;
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
  "provider.list": ProviderSummary[];
  "provider.setRuntimeKey": ProviderSummary[];
  "provider.configuration.get": PiProviderConfigurationSnapshot;
  "provider.configuration.save": PiProviderConfigurationSnapshot;
  "provider.configuration.remove": PiProviderConfigurationSnapshot;
  "provider.credential.store": PiProviderConfigurationSnapshot;
  "provider.credential.remove": PiProviderConfigurationSnapshot;
  "model.default.set": PiProviderConfigurationSnapshot;
  "provider.configuration.reload": PiProviderConfigurationSnapshot;
  "thinking.set": SessionControlResult;
  "resource.list": ResourceSummary[];
  "resource.reload": SessionResourceCatalogResult;
  "command.list": CommandDescriptor[];
  "command.invoke": OperationSubmissionResult;
  "extension.catalog.list": ExtensionCatalogResult;
  "extension.package.list": ExtensionPackageListResult;
  "extension.package.checkUpdates": ExtensionPackageUpdatesResult;
  "extension.package.install": ExtensionPackageMutationResult;
  "extension.package.update": ExtensionPackageMutationResult;
  "extension.package.setEnabled": ExtensionPackageMutationResult;
  "extension.package.restoreInheritance": ExtensionPackageMutationResult;
  "extension.package.uninstall": ExtensionPackageMutationResult;
  "extension.ui.respond": { resolved: boolean };
  "approval.respond": { resolved: boolean };
  "diagnostics.collect": RuntimeDiagnostics;
  "doctor.run": DoctorReport;
}

export type AgentCommandType = keyof CommandPayloads;

export const REPLAY_SAFE_CONTROL_MUTATION_TYPES = [
  "runtime.initialize",
  "workspace.open",
  "workspace.register",
  "workspace.unregister",
  "workspace.setTrust",
  "task.close",
  "session.create",
  "session.open",
  "session.fork",
  "session.rollback",
  "session.name",
  "model.select",
  "model.setRuntimeKey",
  "provider.setRuntimeKey",
  "provider.configuration.save",
  "provider.configuration.remove",
  "provider.credential.store",
  "provider.credential.remove",
  "model.default.set",
  "thinking.set",
  "resource.reload",
  "extension.package.install",
  "extension.package.update",
  "extension.package.setEnabled",
  "extension.package.restoreInheritance",
  "extension.package.uninstall"
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

export type { AgentEvent, AgentEventType, EventPayloads, StreamDelta } from "./agent-events.js";

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
