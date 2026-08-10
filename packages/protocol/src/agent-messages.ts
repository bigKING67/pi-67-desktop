import type {
  ApprovalMode,
  ConversationPage,
  ContextFileCatalogResult,
  ContextFileReadResult,
  ContextFileSaveResult,
  DoctorReport,
  ExtensionCatalogResult,
  ExtensionCommandAdapterView,
  ExtensionPackageListResult,
  ExtensionPackageMutationResult,
  ExtensionPackageOnboardingResult,
  ExtensionPackageScope,
  PackageResourceType,
  ExtensionPackageUpdatesResult,
  ModelSummary,
  SessionInteractionMode,
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
  SkillPackListResult,
  SkillPackMutationResult,
  SessionTreeProjection,
  TaskToolMode,
  ApprovalResponseDecision,
  ApprovalResolution,
  LocatedMessageWindow,
  MessageSearchResult,
  UserMessageIndexPage,
  WorkspaceChangesProjection,
  WorkspaceMessageSearchResult,
  UsageReport,
  UsageWindow,
  WorkspaceTrust
} from "@pi67/domain";
import type {
  ConversationOrganizationCommandPayloads,
  ConversationOrganizationCommandResults,
  SessionNameMutation
} from "./conversation-organization-messages.js";
import type { LarkCommandPayloads, LarkCommandResults } from "./lark-command-messages.js";
import type {
  PiCredentialRevealResult,
  PiProviderConfigurationInput,
  PiProviderConfigurationSnapshot
} from "./provider-configuration-schemas.js";
import type { ProtocolError } from "./protocol-error.js";
import type { RuntimeDiagnostics } from "./runtime-diagnostics-contract.js";
import type { SessionCreationResolution } from "./session-creation-resolution-contract.js";
import type {
  WorkspaceFileCommandPayloads,
  WorkspaceFileCommandResults
} from "./workspace-file-messages.js";

export { ProtocolRequestError } from "./protocol-error.js";
export type { ProtocolError, ProtocolErrorCode } from "./protocol-error.js";
export {
  MAX_PROMPT_ATTACHMENT_BYTES,
  MAX_PROMPT_ATTACHMENT_COUNT,
  MAX_PROMPT_ATTACHMENT_NAME_CHARS,
  MAX_PROMPT_ATTACHMENT_TOTAL_BYTES,
  MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES,
  MAX_PROMPT_PATHLESS_ATTACHMENT_BYTES
} from "./prompt-attachment-limits.js";
export type {
  SessionCatalogMutationResult,
  SessionNameMutation
} from "./conversation-organization-messages.js";
export {
  MAX_SESSION_CREATION_ID_CHARS,
  type SessionCreationResolution
} from "./session-creation-resolution-contract.js";
export interface PromptAttachmentRef { id: string; }
export interface PromptWorkspaceFileRef {
  id: string;
  revision: string;
}

export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type PromptAttachmentKind = "image" | "document" | "archive" | "audio" | "video" | "file";

export interface StagedPromptAttachment {
  id: string;
  name: string;
  mimeType: string;
  byteLength: number;
  kind: PromptAttachmentKind;
}

export type PromptDelivery = "new-turn" | "steer" | "follow-up";

export interface PromptSubmitRequest {
  submissionId: string;
  text: string;
  attachments?: PromptAttachmentRef[];
  workspaceFiles?: PromptWorkspaceFileRef[];
  delivery: PromptDelivery;
}

export interface OperationAccepted {
  kind: "accepted";
  operationId: string;
  cancellable: boolean;
  hostEpoch: number;
  sessionId: string;
  sessionFileIdentity: string;
  sessionGeneration: number;
}

interface OperationSettledBase {
  kind: "settled";
  operationId: string;
  operationKind: OperationKind;
  cancellable: false;
  hostEpoch: number;
  sessionId: string;
  sessionFileIdentity: string;
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
  sessionFileIdentity: string;
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
  sessionId: string;
  sessionFileIdentity: string;
  sessionGeneration: number;
  taskToolMode: TaskToolMode;
  activeOperation?: OperationView;
  latestOperationTerminal?: OperationSettled;
}

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandDescriptor {
  name: string;
  source: SlashCommandSource;
  description?: string;
  adapter?: ExtensionCommandAdapterView;
}

export interface SlashCommandCatalogResult {
  items: SlashCommandDescriptor[];
  total: number;
  truncated: boolean;
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

export interface CommandPayloads extends
  WorkspaceFileCommandPayloads,
  ConversationOrganizationCommandPayloads,
  LarkCommandPayloads {
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
  "task.toolMode.set": { mode: TaskToolMode };
  "session.catalog.query": SessionCatalogQuery;
  "session.catalog.contentSearch": { query: string };
  "workspace.usage.report": { window: UsageWindow };
  "session.tree": Record<string, never>;
  "message.page": { direction: "older" | "newer"; cursor?: string; limit?: number };
  "message.index": { offset?: number; limit?: number };
  "message.search": { query: string };
  "message.locate": { id: string };
  "session.create": { creationId: string };
  "session.creation.resolve": { creationId: string };
  "session.open": { path: string; cwdOverride?: string };
  "session.import": { submissionId: string; path: string };
  "session.fork": { entryId: string; position?: "before" | "at" };
  "session.forkFromTask": {
    sourceTaskId: string;
    sourceTaskGeneration: number;
    sourceSessionId: string;
    sourceSessionFileIdentity: string;
    sourceSessionGeneration: number;
    entryId: string;
  };
  "session.rollback": { entryId: string; summarize?: boolean };
  "session.compact": { submissionId: string; instructions?: string };
  "session.name": { mutation: SessionNameMutation };
  "session.interactionMode.set": { mode: SessionInteractionMode };
  "plan.implement": { submissionId: string; planId: string };
  "prompt.submit": PromptSubmitRequest;
  "prompt.steer": { text: string };
  "prompt.followUp": { text: string };
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
  "provider.credential.reveal": { expectedRevision: string; provider: string };
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
  "context.file.list": Record<string, never>;
  "context.file.read": { id: string };
  "context.file.save": { id: string; expectedRevision: string; content: string };
  "command.list": Record<string, never>;
  "command.invoke": { submissionId: string; command: string };
  "extension.catalog.list": Record<string, never>;
  "extension.package.list": Record<string, never>;
  "extension.package.checkUpdates": Record<string, never>;
  "extension.package.install": { source: string; scope: ExtensionPackageScope };
  "extension.package.update": { source: string; scope: ExtensionPackageScope };
  "extension.package.approveObserved": { source: string; scope: ExtensionPackageScope };
  "extension.package.onboarding.get": { source: string; scope: ExtensionPackageScope };
  "extension.package.onboarding.decline": { source: string; scope: ExtensionPackageScope };
  "extension.package.setEnabled": {
    source: string;
    scope: ExtensionPackageScope;
    enabled: boolean;
    resourceType?: PackageResourceType;
  };
  "extension.package.restoreInheritance": { source: string };
  "extension.package.uninstall": { source: string; scope: ExtensionPackageScope };
  "skill.pack.list": Record<string, never>;
  "skill.pack.checkUpdates": Record<string, never>;
  "skill.pack.update": { id: string };
  "skill.pack.restore": { id: string };
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
    decision: ApprovalResponseDecision;
  };
  "diagnostics.collect": Record<string, never>;
  "doctor.run": Record<string, never>;
}

export interface CommandResults extends
  WorkspaceFileCommandResults,
  ConversationOrganizationCommandResults,
  LarkCommandResults {
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
  "task.toolMode.set": { mode: TaskToolMode };
  "session.catalog.query": SessionCatalogPageResult;
  "session.catalog.contentSearch": WorkspaceMessageSearchResult;
  "workspace.usage.report": UsageReport;
  "session.tree": SessionTreeProjection;
  "message.page": ConversationPage;
  "message.index": UserMessageIndexPage;
  "message.search": MessageSearchResult;
  "message.locate": LocatedMessageWindow;
  "session.create": ProjectionMutationAcknowledgement;
  "session.creation.resolve": SessionCreationResolution;
  "session.open": ProjectionMutationAcknowledgement;
  "session.import": OperationSubmissionResult;
  "session.fork": ProjectionMutationAcknowledgement;
  "session.forkFromTask": ProjectionMutationAcknowledgement;
  "session.rollback": ProjectionMutationAcknowledgement;
  "session.compact": OperationSubmissionResult;
  "session.name": ProjectionMutationAcknowledgement;
  "session.interactionMode.set": ProjectionMutationAcknowledgement;
  "plan.implement": OperationSubmissionResult;
  "prompt.submit": OperationSubmissionResult;
  "prompt.steer": Acknowledgement;
  "prompt.followUp": Acknowledgement;
  "queue.clear": QueueClearResult;
  "operation.abort": { aborted: boolean; operationId?: string };
  "model.list": ModelSummary[];
  "model.select": SessionModelCatalogResult;
  "model.setRuntimeKey": SessionModelCatalogResult;
  "provider.list": ProviderSummary[];
  "provider.setRuntimeKey": ProviderSummary[];
  "provider.configuration.get": PiProviderConfigurationSnapshot;
  "provider.configuration.save": PiProviderConfigurationSnapshot;
  "provider.configuration.remove": PiProviderConfigurationSnapshot;
  "provider.credential.store": PiProviderConfigurationSnapshot;
  "provider.credential.reveal": PiCredentialRevealResult;
  "provider.credential.remove": PiProviderConfigurationSnapshot;
  "model.default.set": PiProviderConfigurationSnapshot;
  "provider.configuration.reload": PiProviderConfigurationSnapshot;
  "thinking.set": SessionControlResult;
  "resource.list": ResourceSummary[];
  "resource.reload": SessionResourceCatalogResult;
  "context.file.list": ContextFileCatalogResult;
  "context.file.read": ContextFileReadResult;
  "context.file.save": ContextFileSaveResult;
  "command.list": SlashCommandCatalogResult;
  "command.invoke": OperationSubmissionResult;
  "extension.catalog.list": ExtensionCatalogResult;
  "extension.package.list": ExtensionPackageListResult;
  "extension.package.checkUpdates": ExtensionPackageUpdatesResult;
  "extension.package.install": ExtensionPackageMutationResult;
  "extension.package.update": ExtensionPackageMutationResult;
  "extension.package.approveObserved": ExtensionPackageMutationResult;
  "extension.package.onboarding.get": ExtensionPackageOnboardingResult;
  "extension.package.onboarding.decline": ExtensionPackageOnboardingResult;
  "extension.package.setEnabled": ExtensionPackageMutationResult;
  "extension.package.restoreInheritance": ExtensionPackageMutationResult;
  "extension.package.uninstall": ExtensionPackageMutationResult;
  "skill.pack.list": SkillPackListResult;
  "skill.pack.checkUpdates": SkillPackListResult;
  "skill.pack.update": SkillPackMutationResult;
  "skill.pack.restore": SkillPackMutationResult;
  "extension.ui.respond": { resolved: boolean };
  "approval.respond": ApprovalResolution;
  "diagnostics.collect": RuntimeDiagnostics;
  "doctor.run": DoctorReport;
}

export type AgentCommandType = keyof CommandPayloads;

export {
  REPLAY_SAFE_CONTROL_MUTATION_TYPES,
  REPLAY_SAFE_OPERATION_ACK_TYPES,
  isReplaySafeControlMutation,
  isReplaySafeOperationAck,
  type ReplaySafeControlMutationType,
  type ReplaySafeOperationAckType
} from "./replay-safe-commands.js";

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
