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
import type { StagedPromptAttachment } from "./agent-messages.js";
import type {
  AgentHostStartupFailedMessage,
  AgentHostStartupState
} from "./supervisor-messages.js";
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

export interface DesktopAgentHostStartupState {
  hostEpoch: number;
  startup: AgentHostStartupState;
}

export interface DesktopAgentHostFailureState {
  hostEpoch?: number;
  code: number;
  recoverable: boolean;
  attempt?: number;
  startupFailure?: AgentHostStartupFailedMessage;
}

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
  expandedWorkspaceIds: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecord[];
  sessionCreationRecovery: SessionCreationRecoveryRecord[];
  settings: WorkbenchSettingsState;
}

export interface ShutdownCheckpointResponse {
  requestId: string;
  succeeded: boolean;
}

export type SecureStorageAccess = "available" | "unavailable";

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
  repairWorkspace(workspaceId: string): Promise<WorkspaceDescriptor | undefined>;
  removeWorkspace(workspaceId: string): Promise<WorkbenchStateV5>;
  reorderWorkspaces(workspaceIds: string[]): Promise<WorkbenchStateV5>;
  selectWorkspace(): Promise<string | undefined>;
  selectSessionFile(): Promise<string | undefined>;
  getRecoverySnapshot(): Promise<DesktopRecoverySnapshot>;
  saveDiagnostics(request: SupportDiagnosticsExportRequest): Promise<string | undefined>;
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
  savePackageNetworkSettings(settings: PackageNetworkSettings): Promise<PackageNetworkSnapshot>;
  resetPackageNetworkSettings(): Promise<PackageNetworkSnapshot>;
  probePackageSources(settings: PackageNetworkSettings): Promise<PackageNetworkSnapshot>;
  getDesktopCapabilitySnapshot(): Promise<DesktopCapabilitySnapshot>;
  setupBrowser67(): Promise<DesktopCapabilitySnapshot>;
  doctorBrowser67(): Promise<DesktopCapabilitySnapshot>;
  prepareBrowser67Extension(): Promise<DesktopCapabilitySnapshot>;
  openBrowser67ExtensionPage(browser: "chrome" | "edge"): Promise<boolean>;
  revealBrowser67Extension(): Promise<boolean>;
  copyBrowser67ExtensionPath(): Promise<boolean>;
  verifyBrowser67Extension(options: { startHub: boolean }): Promise<DesktopCapabilitySnapshot>;
  getUpdateState(): Promise<unknown>;
  checkForUpdates(): Promise<unknown>;
  startUpdate(): Promise<unknown>;
  cancelUpdate(): Promise<unknown>;
  onUpdateStateChanged(listener: (state: unknown) => void): () => void;
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
