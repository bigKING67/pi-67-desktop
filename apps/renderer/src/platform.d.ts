import type {
  ComposerDraftPersistedState,
  ComposerDraftStateSnapshot,
  PackageNetworkSettings,
  PackageNetworkSnapshot,
  DesktopCapabilitySnapshot,
  NativeNotificationActivation,
  NativeNotificationRequest,
  RuntimeRecoveryRecord,
  SessionCreationRecoveryRecord,
  WorkspaceEntryContextAction,
  WorkspaceEntryRequest,
  WorkspaceFilePersistedState,
  WorkspaceFileStateSnapshot,
  WorkbenchSettingsState,
  WorkbenchStateV5,
  WorkbenchSurface,
  WorkspaceDescriptor
} from "@pi67/domain";
import type {
  DesktopRecoverySnapshot,
  RepositoryEnvironmentInspectionRequest,
  RepositoryEnvironmentSnapshot,
  RepositoryChangeDetail,
  RepositoryChangeDetailRequest,
  RepositoryWorkingTreeInspectionRequest,
  RepositoryWorkingTreeSnapshot,
  PromptStashImagesDeleteRequest,
  PromptStashImagesRestoreRequest,
  PromptStashImagesRestoreResult,
  PromptStashImagesStoreRequest,
  PromptStashImagesStoreResult,
  SupportDiagnosticsExportRequest,
  StagedPromptAttachment,
  WorktreeCreationAdvanceRequest,
  WorktreeCreationAdvanceResult,
  WorktreeCreationRequest,
  WorktreeCreationResult,
  WorktreeCreationRollbackRequest,
  WorktreeCreationRollbackResult
} from "@pi67/protocol";

export type WorkbenchLayoutV5 = {
  expandedWorkspaceIds: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecord[];
  sessionCreationRecovery: SessionCreationRecoveryRecord[];
  settings: WorkbenchSettingsState;
};

declare global {
  interface Window {
    pi67: {
      system: {
        getPlatformInfo(): Promise<{ platform: "win32" | "darwin"; architecture: "x64" | "arm64"; version: string }>;
        connectAgentHost(options?: { replaceCurrent?: boolean }): Promise<void>;
        stagePromptAttachments(files: File[]): Promise<StagedPromptAttachment[]>;
        releasePromptAttachments(ids: string[]): Promise<void>;
        storePromptStashImages(request: PromptStashImagesStoreRequest): Promise<PromptStashImagesStoreResult>;
        restorePromptStashImages(request: PromptStashImagesRestoreRequest): Promise<PromptStashImagesRestoreResult>;
        deletePromptStashImages(request: PromptStashImagesDeleteRequest): Promise<void>;
        loadWorkbenchState(): Promise<WorkbenchStateV5>;
        inspectRepositoryEnvironment(
          request: RepositoryEnvironmentInspectionRequest
        ): Promise<RepositoryEnvironmentSnapshot>;
        inspectRepositoryWorkingTree(
          request: RepositoryWorkingTreeInspectionRequest
        ): Promise<RepositoryWorkingTreeSnapshot>;
        readRepositoryChangeDetail(
          request: RepositoryChangeDetailRequest
        ): Promise<RepositoryChangeDetail>;
        createWorktreeEnvironment(request: WorktreeCreationRequest): Promise<WorktreeCreationResult>;
        advanceWorktreeEnvironment(
          request: WorktreeCreationAdvanceRequest
        ): Promise<WorktreeCreationAdvanceResult>;
        rollbackWorktreeEnvironment(
          request: WorktreeCreationRollbackRequest
        ): Promise<WorktreeCreationRollbackResult>;
        loadComposerDraftState(): Promise<ComposerDraftStateSnapshot>;
        updateComposerDraftState(state: ComposerDraftPersistedState): Promise<ComposerDraftStateSnapshot>;
        loadWorkspaceFileState(): Promise<WorkspaceFileStateSnapshot>;
        updateWorkspaceFileState(state: WorkspaceFilePersistedState): Promise<WorkspaceFileStateSnapshot>;
        updateWorkbenchLayout(layout: WorkbenchLayoutV5): Promise<WorkbenchStateV5>;
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
        onUpdateStateChanged(listener: (state: unknown) => void): () => void;
        onAgentHostFailed(listener: (state: { code: number; recoverable: boolean; attempt?: number }) => void): () => void;
        onPowerResume(listener: () => void): () => void;
        onNativeNotificationActivated(listener: (activation: NativeNotificationActivation) => void): () => void;
      };
    };
  }
}
