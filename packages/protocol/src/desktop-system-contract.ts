import type {
  ComposerDraftPersistedState,
  ComposerDraftStateSnapshot,
  DesktopCapabilitySnapshot,
  DesktopRecoverySnapshot,
  NativeNotificationActivation,
  NativeNotificationRequest,
  PackageNetworkSettings,
  PackageNetworkSnapshot,
  RuntimeRecoveryRecord,
  SessionCreationRecoveryRecord,
  WorkbenchSettingsState,
  WorkbenchStateV5,
  WorkbenchSurface,
  WorkspaceDescriptor,
  WorkspaceEntryContextAction,
  WorkspaceEntryRequest,
  WorkspaceFilePersistedState,
  WorkspaceFileStateSnapshot
} from "@pi67/domain";
import type { SupportDiagnosticsUploadReceipt } from "@pi67/support-contract";
import type { DesktopUpdateState } from "./desktop-update-state.js";
import type {
  DesktopAgentHostFailureState,
  DesktopAgentHostStartupState,
  ShutdownCheckpointResponse
} from "./desktop-bridge-messages.js";
import type { LocalMemorySettingsBridge } from "./local-memory-settings.js";
import type { StagedPromptAttachment } from "./agent-messages.js";
import type {
  PromptStashImagesDeleteRequest,
  PromptStashImagesRestoreRequest,
  PromptStashImagesRestoreResult,
  PromptStashImagesStoreRequest,
  PromptStashImagesStoreResult
} from "./prompt-stash-images.js";
import type {
  AppOwnedWorktreeRecoveryRequest,
  AppOwnedWorktreeRecoveryResult,
  RepositoryChangeDetail,
  RepositoryChangeDetailRequest,
  RepositoryEnvironmentInspectionRequest,
  RepositoryEnvironmentSnapshot,
  RepositorySubmoduleInitializationRequest,
  RepositorySubmoduleInitializationResult,
  RepositoryWorkingTreeInspectionRequest,
  RepositoryWorkingTreeSnapshot
} from "./repository-environment-contract.js";
import type { SupportDiagnosticsExportRequest } from "./runtime-diagnostics-contract.js";
import type {
  WorktreeCreationAdvanceRequest,
  WorktreeCreationAdvanceResult,
  WorktreeCreationActivityRequest,
  WorktreeCreationActivityResult,
  WorktreeCreationCancelRequest,
  WorktreeCreationCancelResult,
  WorktreeCreationRequest,
  WorktreeCreationResult,
  WorktreeCreationRollbackRequest,
  WorktreeCreationRollbackResult
} from "./worktree-creation-contract.js";

export {
  MAX_COMPOSER_DRAFTS,
  MAX_COMPOSER_DRAFT_TEXT_BYTES,
  MAX_COMPOSER_DRAFT_TEXT_BYTES_TOTAL,
  MAX_COMPOSER_REVIEW_COMMENTS,
  MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES,
  MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES_TOTAL,
  MAX_COMPOSER_WORKSPACE_FILE_REFS,
  MAX_PROMPT_STASH_ITEMS,
  MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM,
  MAX_PROMPT_STASH_IMAGE_BYTES_PER_TASK,
  MAX_PROMPT_STASH_IMAGE_BYTES_TOTAL,
  MAX_PROMPT_STASH_TEXT_BYTES_TOTAL,
  MAX_WORKSPACE_FILE_DRAFT_BYTES_TOTAL,
  MAX_WORKSPACE_FILE_PATH_CHARS,
  MAX_WORKSPACE_FILE_TABS_PER_WORKSPACE,
  MAX_WORKSPACE_FILE_TABS_TOTAL,
  MAX_RUNNING_TASKS,
  defaultPackageNetworkSettings,
  gitSourceCandidates,
  npmRegistryCandidates,
  parsePackageNetworkSettings,
  type DesktopCapabilityOrigin,
  type ComposerDraftPersistedState,
  type ComposerDraftRecord,
  type ComposerDraftStateSnapshot,
  type ComposerReviewComment,
  type ComposerWorkspaceFileRef,
  type ChangeReviewAnchor,
  type ChangeReviewAuthority,
  type ChangeReviewPatchSection,
  type ChangeReviewSide,
  type PromptStashItem,
  type PromptStashImageRef,
  type DesktopBundledExtensionSummary,
  type DesktopBundledSkillSummary,
  type DesktopBundledSkillSuiteSummary,
  type DesktopCapabilityPackageSummary,
  type DesktopCapabilityResourceType,
  type DesktopCapabilitySnapshot,
  type DesktopRecoverySnapshot,
  type DesktopRuntimeHealthDiagnostics,
  type AgentHostLifecyclePhase,
  type DesktopIntegrationStatus,
  type NativeNotificationActivation,
  type NativeNotificationKind,
  type NativeNotificationRequest,
  type DesktopRecommendedPackage,
  type DesktopToolchainStatus,
  type PackageNetworkSettings,
  type PackageNetworkSnapshot,
  type PackageSourceHealth,
  type PreviousRunExitStatus,
  type PromptAttachmentStagingDiagnostics,
  type WorkspaceDescriptor,
  type WorkspaceEntryContextAction,
  type WorkspaceEntryRequest,
  type WorkspaceFileKind,
  type WorkspaceFilePersistedState,
  type WorkspaceFilePersistedTab,
  type WorkspaceFileStateSnapshot
} from "@pi67/domain";

export interface DesktopPlatformInfo {
  platform: "win32" | "darwin";
  architecture: "x64" | "arm64";
  version: string;
}

/** Largest content width that still uses the Inspector drawer instead of a docked third region. */
export const DESKTOP_CONTEXT_DRAWER_MAX_WIDTH = 1_320;

export type { DesktopAgentHostFailureState, DesktopAgentHostStartupState } from "./desktop-bridge-messages.js";

export interface PromptAttachmentNormalization {
  readonly kind: "heic-to-jpeg";
  readonly sourceName: string;
  readonly sourceMimeType: string;
  readonly sourceByteLength: number;
}

export interface StagedPromptAttachmentResult extends StagedPromptAttachment {
  readonly normalization?: PromptAttachmentNormalization;
}

/** Renderer-owned fields persisted through Electron Main. */
export interface WorkbenchLayoutV5 {
  conversationDefaults?: import("@pi67/domain").WorkspaceConversationDefault[];
  expandedWorkspaceIds: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecord[];
  sessionCreationRecovery: SessionCreationRecoveryRecord[];
  settings: WorkbenchSettingsState;
}

export type SecureStorageAccess = "available" | "unavailable";

/** A Team Chat attachment the renderer read through Agent Host, to save where the user picks. */
export interface TeamChatAttachmentSaveRequest {
  fileName: string;
  data: ArrayBuffer;
}

/** Complete, typed surface exposed by the sandboxed Desktop preload. */
export interface DesktopSystemBridge {
  getPlatformInfo(): Promise<DesktopPlatformInfo>;
  ensureContextPanelRoom(): Promise<boolean>;
  connectAgentHost(options?: { replaceCurrent?: boolean }): Promise<void>;
  stagePromptAttachments(files: DesktopPromptAttachmentInput[]): Promise<StagedPromptAttachmentResult[]>;
  releasePromptAttachments(ids: string[]): Promise<void>;
  storePromptStashImages(request: PromptStashImagesStoreRequest): Promise<PromptStashImagesStoreResult>;
  restorePromptStashImages(request: PromptStashImagesRestoreRequest): Promise<PromptStashImagesRestoreResult>;
  deletePromptStashImages(request: PromptStashImagesDeleteRequest): Promise<void>;
  loadWorkbenchState(): Promise<WorkbenchStateV5>;
  inspectRepositoryEnvironment(
    request: RepositoryEnvironmentInspectionRequest
  ): Promise<RepositoryEnvironmentSnapshot>;
  initializeRepositorySubmodules(
    request: RepositorySubmoduleInitializationRequest
  ): Promise<RepositorySubmoduleInitializationResult>;
  recoverAppOwnedWorktree(request: AppOwnedWorktreeRecoveryRequest): Promise<AppOwnedWorktreeRecoveryResult>;
  inspectRepositoryWorkingTree(
    request: RepositoryWorkingTreeInspectionRequest
  ): Promise<RepositoryWorkingTreeSnapshot>;
  readRepositoryChangeDetail(request: RepositoryChangeDetailRequest): Promise<RepositoryChangeDetail>;
  createWorktreeEnvironment(request: WorktreeCreationRequest): Promise<WorktreeCreationResult>;
  getWorktreeCreationActivity(request: WorktreeCreationActivityRequest): Promise<WorktreeCreationActivityResult>;
  cancelWorktreeCreation(request: WorktreeCreationCancelRequest): Promise<WorktreeCreationCancelResult>;
  advanceWorktreeEnvironment(request: WorktreeCreationAdvanceRequest): Promise<WorktreeCreationAdvanceResult>;
  rollbackWorktreeEnvironment(request: WorktreeCreationRollbackRequest): Promise<WorktreeCreationRollbackResult>;
  loadComposerDraftState(): Promise<ComposerDraftStateSnapshot>;
  ensureSecureStorageAccess(): Promise<SecureStorageAccess>;
  updateComposerDraftState(state: ComposerDraftPersistedState): Promise<ComposerDraftStateSnapshot>;
  loadWorkspaceFileState(): Promise<WorkspaceFileStateSnapshot>;
  updateWorkspaceFileState(state: WorkspaceFilePersistedState): Promise<WorkspaceFileStateSnapshot>;
  updateWorkbenchLayout(layout: WorkbenchLayoutV5): Promise<WorkbenchStateV5>;
  completeShutdownCheckpoint(response: ShutdownCheckpointResponse): Promise<boolean>;
  pickAndAddWorkspace(): Promise<WorkspaceDescriptor | undefined>;
  /** Picks the creative library directory once and registers it as the hidden library Workspace (ADR 0010). */
  chooseImageLibrary(): Promise<WorkspaceDescriptor | undefined>;
  /** Saves a rendered image PNG the user is viewing, after Main re-verifies its digest. */
  saveImage(request: { workspaceId: string; projectId: string; pngSha256: string; fileName: string }): Promise<boolean>;
  /**
   * Saves several rendered PNGs (one per size) into a new folder under a place the
   * person picks, with a receipt; undefined when they cancel. Main re-verifies each digest.
   */
  saveImageSet(request: { workspaceId: string; title: string; items: { projectId: string; revision: number; pngSha256: string; fileName: string }[] }): Promise<{ folderName: string } | undefined>;
  repairWorkspace(workspaceId: string): Promise<WorkspaceDescriptor | undefined>;
  removeWorkspace(workspaceId: string): Promise<WorkbenchStateV5>;
  reorderWorkspaces(workspaceIds: string[]): Promise<WorkbenchStateV5>;
  selectWorkspace(): Promise<string | undefined>;
  selectSessionFile(): Promise<string | undefined>;
  getRecoverySnapshot(): Promise<DesktopRecoverySnapshot>;
  uploadDiagnostics(request: SupportDiagnosticsExportRequest): Promise<SupportDiagnosticsUploadReceipt>;
  saveDiagnostics(request: SupportDiagnosticsExportRequest): Promise<string | undefined>;
  /** Asks where to save a Team Chat attachment's bytes; false when the user cancels (ADR 0009). */
  saveTeamChatAttachment(request: TeamChatAttachmentSaveRequest): Promise<boolean>;
  showNativeNotification(request: NativeNotificationRequest): Promise<boolean>;
  dismissNativeNotification(notificationId: string): Promise<boolean>;
  requestOpenExternal(url: string): Promise<boolean>;
  showWorkspaceEntryContextMenu(
    entry: WorkspaceEntryRequest,
    includeManagement?: boolean
  ): Promise<WorkspaceEntryContextAction | undefined>;
  revealWorkspaceEntry(entry: WorkspaceEntryRequest): Promise<boolean>;
  openWorkspaceEntryInDefaultApp(entry: WorkspaceEntryRequest): Promise<boolean>;
  copyWorkspaceEntryPath(entry: WorkspaceEntryRequest, mode: "absolute" | "relative"): Promise<boolean>;
  trashWorkspaceEntry(entry: WorkspaceEntryRequest): Promise<boolean>;
  getPackageNetworkSnapshot(): Promise<PackageNetworkSnapshot>;
  /**
   * Optional during the local-memory rollout. Snapshots never carry stored credentials; only an
   * explicit one-shot `revealKey` request returns the saved API key, after Main re-authorizes the sender.
   */
  localMemoryModels?: LocalMemorySettingsBridge;
  localMemoryRuntime?: import("./local-memory-runtime.js").LocalMemoryRuntimeBridge;
  localMemoryActivation?: import("./local-memory-activation.js").LocalMemoryActivationBridge;
  savePackageNetworkSettings(settings: PackageNetworkSettings): Promise<PackageNetworkSnapshot>;
  resetPackageNetworkSettings(): Promise<PackageNetworkSnapshot>;
  probePackageSources(settings: PackageNetworkSettings): Promise<PackageNetworkSnapshot>;
  // Renderer validates each value with the parsePackageMarket* functions before use.
  packageMarket: import("./package-market.js").PackageMarketBridge;
  getDesktopCapabilitySnapshot(): Promise<DesktopCapabilitySnapshot>;
  setupBrowser67(): Promise<DesktopCapabilitySnapshot>;
  doctorBrowser67(): Promise<DesktopCapabilitySnapshot>;
  prepareBrowser67Extension(): Promise<DesktopCapabilitySnapshot>;
  openBrowser67ExtensionPage(browser: "chrome" | "edge"): Promise<boolean>;
  revealBrowser67Extension(): Promise<boolean>;
  copyBrowser67ExtensionPath(): Promise<boolean>;
  verifyBrowser67Extension(options: { startHub: boolean }): Promise<DesktopCapabilitySnapshot>;
  // Renderer still validates each value with parseDesktopUpdateState before use.
  getUpdateState(): Promise<DesktopUpdateState>;
  checkForUpdates(): Promise<DesktopUpdateState>;
  startUpdate(): Promise<DesktopUpdateState>;
  cancelUpdate(): Promise<DesktopUpdateState>;
  onUpdateStateChanged(listener: (state: DesktopUpdateState) => void): () => void;
  onAgentHostFailed(
    listener: (state: DesktopAgentHostFailureState) => void
  ): () => void;
  onAgentHostStartup(listener: (state: DesktopAgentHostStartupState) => void): () => void;
  onPowerResume(listener: () => void): () => void;
  onNativeNotificationActivated(listener: (activation: NativeNotificationActivation) => void): () => void;
  onShutdownCheckpointRequested(listener: (requestId: string) => void): () => void;
}

export interface DesktopPromptAttachmentInput {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}
