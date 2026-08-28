import type {
  ApprovalMode,
  ConversationPage,
  DoctorReport,
  ExtensionCatalogResult,
  ExtensionUiCancellationReason,
  ModelSummary,
  ResourceCatalogProjection,
  RuntimeCapabilities,
  RuntimeIdentity,
  RuntimeOperationActivity,
  ToolExecutionView,
  SessionCatalogPage,
  SessionCatalogQuery,
  SessionCatalogStatus,
  SessionControlResult,
  SessionModelCatalogResult,
  SessionResourceCatalogResult,
  SessionSnapshot,
  SessionInteractionMode,
  PlanImplementationRequestLineage,
  SessionTreeProjection,
  WorkspaceChangesProjection,
  WorkspaceTrust,
  TaskToolMode,
  ApprovalResponseDecision,
  ApprovalResolution,
  UserMessageIndexPage,
  LocatedMessageWindow,
  MessageSearchResult,
  NativeSubagentMode,
  NativeSubagentView,
  NativeSubagentWaitResult
} from "@pi67/domain";
import type {
  AgentEvent,
  AssetReadResult,
  SlashCommandCatalogResult,
  PiConfigurationReloadState,
  PromptAttachmentRef,
  RuntimeDiagnostics,
} from "@pi67/protocol";
import type { RuntimeQueueClearResult } from "./session-queue.js";
import type { PreparedPromptAttachmentSet } from "./prompt-attachment.js";

export interface RuntimeInitializeOptions {
  cwd: string;
  agentDir?: string;
  sessionPath?: string;
  /** Internal Host bootstrap identity used only when session.create initializes a fresh Task. */
  creationId?: string;
  trust: WorkspaceTrust;
  approvalMode: ApprovalMode;
}

export type RuntimeInitializationStage =
  | "resolve-session"
  | "dispose-current"
  | "create-session"
  | "load-model-runtime"
  | "validate-packages"
  | "load-session-resources"
  | "activate-session"
  | "reload-configuration"
  | "project-snapshot";

export interface RuntimeInitializationObservation {
  stage: RuntimeInitializationStage;
  outcome: "started" | "completed" | "failed";
  durationMs: number;
}

export type RuntimeInitializationObserver = (observation: RuntimeInitializationObservation) => void;

export interface AgentRuntime {
  getSdkVersion(): string;
  getExtensionUiCapabilities(): RuntimeCapabilities["extensionUi"];
  initialize(
    options: RuntimeInitializeOptions,
    observeStage?: RuntimeInitializationObserver
  ): Promise<SessionSnapshot>;
  dispose(): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  subscribeOperationActivity?(listener: (activity: RuntimeOperationActivity) => void): () => void;
  subscribeToolExecution?(listener: (execution: ToolExecutionView) => void): () => void;
  setWorkspacePolicy(trust: WorkspaceTrust, approvalMode: ApprovalMode): TaskToolMode;
  getTaskToolMode(): TaskToolMode;
  setTaskToolMode(mode: TaskToolMode): TaskToolMode;
  requestConfigurationReload(revision: string): Promise<PiConfigurationReloadState>;
  querySessionCatalog(query: SessionCatalogQuery): Promise<SessionCatalogPage>;
  getSessionCatalogStatus(): SessionCatalogStatus;
  getSessionTree(): SessionTreeProjection;
  getWorkspaceChanges(): WorkspaceChangesProjection;
  getMessagePage(options: { direction: "older" | "newer"; cursor?: string; limit?: number }): ConversationPage;
  getUserMessageIndex(options: { offset?: number; limit?: number }): UserMessageIndexPage;
  searchMessages(query: string): MessageSearchResult;
  locateMessage(id: string): LocatedMessageWindow;
  readAsset(options: { assetId: string; sessionGeneration: number; offset: number; length?: number }): AssetReadResult;
  createSession(creationId: string): Promise<SessionSnapshot>;
  openSession(path: string, cwdOverride?: string): Promise<SessionSnapshot>;
  importSession(path: string): Promise<SessionSnapshot>;
  forkSession(entryId: string, position?: "before" | "at"): Promise<SessionSnapshot>;
  forkSessionFrom(sourcePath: string, entryId: string): Promise<SessionSnapshot>;
  rollback(entryId: string, summarize?: boolean): Promise<void>;
  compact(instructions?: string): Promise<void>;
  setSessionName(name?: string): Promise<void>;
  regenerateSessionTitle(): Promise<void>;
  setInteractionMode(mode: SessionInteractionMode): Promise<void>;
  implementPlan(planId: string, lineage: PlanImplementationRequestLineage): Promise<void>;
  preparePromptAttachments(
    submissionId: string,
    refs: readonly PromptAttachmentRef[]
  ): Promise<PreparedPromptAttachmentSet | undefined>;
  submitPrompt(text: string, attachments?: PreparedPromptAttachmentSet): Promise<void>;
  steer(text: string, attachments?: PreparedPromptAttachmentSet): Promise<void>;
  followUp(text: string, attachments?: PreparedPromptAttachmentSet): Promise<void>;
  clearQueue(): RuntimeQueueClearResult;
  abort(): Promise<void>;
  selectModel(provider: string, id: string): Promise<SessionModelCatalogResult>;
  setRuntimeApiKey(provider: string, apiKey: string): Promise<SessionModelCatalogResult>;
  setThinkingLevel(level: string): Promise<SessionControlResult>;
  reloadResources(): Promise<SessionResourceCatalogResult>;
  invokeCommand(command: string): Promise<void>;
  flushStream(): void;
  getIdentity(): RuntimeIdentity;
  getSnapshot(): SessionSnapshot;
  getModels(): ModelSummary[];
  getResources(): ResourceCatalogProjection;
  getCommands(): SlashCommandCatalogResult;
  getExtensionCatalog(): ExtensionCatalogResult;
  resolveExtensionUi(requestId: string, value?: string | boolean, cancelled?: boolean): boolean;
  resolveApproval(
    requestId: string,
    toolCallId: string,
    decision: ApprovalResponseDecision
  ): ApprovalResolution;
  hasPendingSubagentApproval(requestId: string, toolCallId: string): boolean;
  cancelInteractiveRequests(reason: ExtensionUiCancellationReason): string[];
  listSubagents(): NativeSubagentView[];
  getSubagentStatus(id: string): NativeSubagentView;
  waitForSubagents(
    ids: readonly string[],
    mode: "first" | "all",
    timeoutMs: number
  ): Promise<NativeSubagentWaitResult>;
  steerSubagent(id: string, text: string): Promise<NativeSubagentView>;
  stopSubagent(id: string): Promise<NativeSubagentView>;
  resumeSubagent(id: string, mode?: NativeSubagentMode): Promise<NativeSubagentView>;
  collectDiagnostics(): Promise<RuntimeDiagnostics>;
  runDoctor(): Promise<DoctorReport>;
}
