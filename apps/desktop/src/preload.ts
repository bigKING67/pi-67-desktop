import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  ComposerDraftPersistedState,
  AppOwnedWorktreeRecoveryRequest,
  AppOwnedWorktreeRecoveryResult,
  ComposerDraftStateSnapshot,
  DesktopCapabilitySnapshot,
  DesktopAgentHostFailureState,
  DesktopAgentHostStartupState,
  DesktopPlatformInfo,
  DesktopRecoverySnapshot,
  DesktopSystemBridge,
  NativeNotificationActivation,
  NativeNotificationRequest,
  PackageNetworkSettings,
  PackageNetworkSnapshot,
  PromptStashImagesDeleteRequest,
  PromptStashImagesRestoreRequest,
  PromptStashImagesRestoreResult,
  PromptStashImagesStoreRequest,
  PromptStashImagesStoreResult,
  RepositoryChangeDetail,
  RepositoryChangeDetailRequest,
  RepositoryEnvironmentInspectionRequest,
  RepositoryEnvironmentSnapshot,
  RepositorySubmoduleInitializationRequest,
  RepositorySubmoduleInitializationResult,
  RepositoryWorkingTreeInspectionRequest,
  RepositoryWorkingTreeSnapshot,
  SupportDiagnosticsExportRequest,
  StagedPromptAttachmentResult,
  WorktreeCreationRequest,
  WorktreeCreationAdvanceRequest,
  WorktreeCreationAdvanceResult,
  WorktreeCreationActivityRequest,
  WorktreeCreationActivityResult,
  WorktreeCreationCancelRequest,
  WorktreeCreationCancelResult,
  WorktreeCreationResult,
  WorktreeCreationRollbackRequest,
  WorktreeCreationRollbackResult,
  WorkspaceEntryContextAction,
  WorkspaceEntryRequest,
  WorkspaceFilePersistedState,
  WorkspaceFileStateSnapshot
} from "@pi67/protocol";
import {
  isRepositoryChangeDetail,
  isRepositoryEnvironmentSnapshot,
  isRepositoryWorkingTreeSnapshot
} from "@pi67/protocol/repository-environment-snapshot-validation";
import {
  isAppOwnedWorktreeRecoveryResult,
  isRepositorySubmoduleInitializationResult
} from "@pi67/protocol/repository-environment-action-result-validation";
import {
  isPromptStashImagesRestoreResult,
  isPromptStashImagesStoreResult
} from "@pi67/protocol/prompt-stash-images";
import {
  isWorktreeCreationAdvanceResult,
  isWorktreeCreationActivityResult,
  isWorktreeCreationCancelResult,
  isWorktreeCreationResult,
  isWorktreeCreationRollbackResult
} from "@pi67/protocol/worktree-creation-result-validation";
import { isTrustedRendererOrigin } from "./renderer-security.js";
import { stagePromptAttachmentsFromPreload } from "./prompt-attachment-preload.js";
import type {
  WorkbenchLayoutV5,
  WorkbenchStateV5
} from "./workbench-state.js";
import type { WorkspaceDescriptor } from "./workspace-identity.js";

export type {
  WorkbenchLayoutV5,
  WorkbenchStateV5,
} from "./workbench-state.js";
export type {
  NativeWorkspaceDescriptor,
  WorkspaceDescriptor,
  WorkspacePathIdentity
} from "./workspace-identity.js";

const systemBridge = {
  getPlatformInfo: (): Promise<DesktopPlatformInfo> => ipcRenderer.invoke("pi67:platform-info"),
  ensureContextPanelRoom: async (): Promise<boolean> => (
    await ipcRenderer.invoke("pi67:context-panel-room") === true
  ),
  connectAgentHost: (options?: { replaceCurrent?: boolean }): Promise<void> => (
    ipcRenderer.invoke("pi67:agent-host-connect", options?.replaceCurrent === true)
  ),
  stagePromptAttachments: (files: File[]) => stagePromptAttachmentsFromPreload(files, {
    getPathForFile: (file) => webUtils.getPathForFile(file),
    invoke: (channel, value) => ipcRenderer.invoke(channel, value)
  }),
  releasePromptAttachments: (ids: string[]): Promise<void> => (
    ipcRenderer.invoke("pi67:prompt-attachments-release", ids)
  ),
  storePromptStashImages: async (
    request: PromptStashImagesStoreRequest
  ): Promise<PromptStashImagesStoreResult> => {
    const value = await ipcRenderer.invoke("pi67:prompt-stash-images-store", request) as unknown;
    if (!isPromptStashImagesStoreResult(value)) throw new Error("Prompt Stash image store response is invalid.");
    return value;
  },
  restorePromptStashImages: async (
    request: PromptStashImagesRestoreRequest
  ): Promise<PromptStashImagesRestoreResult> => {
    const value = await ipcRenderer.invoke("pi67:prompt-stash-images-restore", request) as unknown;
    if (!isPromptStashImagesRestoreResult(value)) throw new Error("Prompt Stash image restore response is invalid.");
    return value;
  },
  deletePromptStashImages: (request: PromptStashImagesDeleteRequest): Promise<void> => (
    ipcRenderer.invoke("pi67:prompt-stash-images-delete", request)
  ),
  loadWorkbenchState: (): Promise<WorkbenchStateV5> => ipcRenderer.invoke("pi67:workbench-load"),
  inspectRepositoryEnvironment: async (
    request: RepositoryEnvironmentInspectionRequest
  ): Promise<RepositoryEnvironmentSnapshot> => {
    const value = await ipcRenderer.invoke("pi67:repository-environment-inspect", request) as unknown;
    if (!isRepositoryEnvironmentSnapshot(value)) {
      throw new Error("Repository environment response is invalid.");
    }
    return value;
  },
  initializeRepositorySubmodules: async (
    request: RepositorySubmoduleInitializationRequest
  ): Promise<RepositorySubmoduleInitializationResult> => {
    const value = await ipcRenderer.invoke("pi67:repository-submodules-initialize", request) as unknown;
    if (!isRepositorySubmoduleInitializationResult(value)) {
      throw new Error("Invalid Repository Submodule initialization response.");
    }
    return value;
  },
  recoverAppOwnedWorktree: async (
    request: AppOwnedWorktreeRecoveryRequest
  ): Promise<AppOwnedWorktreeRecoveryResult> => {
    const value = await ipcRenderer.invoke("pi67:app-owned-worktree-recover", request) as unknown;
    if (!isAppOwnedWorktreeRecoveryResult(value)) {
      throw new Error("Invalid app-owned Worktree recovery response.");
    }
    return value;
  },
  inspectRepositoryWorkingTree: async (
    request: RepositoryWorkingTreeInspectionRequest
  ): Promise<RepositoryWorkingTreeSnapshot> => {
    const value = await ipcRenderer.invoke("pi67:repository-working-tree-inspect", request) as unknown;
    if (!isRepositoryWorkingTreeSnapshot(value)) throw new Error("Invalid repository working tree response.");
    return value;
  },
  readRepositoryChangeDetail: async (
    request: RepositoryChangeDetailRequest
  ): Promise<RepositoryChangeDetail> => {
    const value = await ipcRenderer.invoke("pi67:repository-change-detail", request) as unknown;
    if (!isRepositoryChangeDetail(value)) throw new Error("Invalid repository change detail response.");
    return value;
  },
  createWorktreeEnvironment: async (
    request: WorktreeCreationRequest
  ): Promise<WorktreeCreationResult> => {
    const value = await ipcRenderer.invoke("pi67:worktree-environment-create", request) as unknown;
    if (!isWorktreeCreationResult(value)) {
      throw new Error("Worktree creation response is invalid.");
    }
    return value;
  },
  getWorktreeCreationActivity: async (
    request: WorktreeCreationActivityRequest
  ): Promise<WorktreeCreationActivityResult> => {
    const value = await ipcRenderer.invoke("pi67:worktree-environment-activity", request) as unknown;
    if (!isWorktreeCreationActivityResult(value)) throw new Error("Invalid Worktree creation activity response.");
    return value;
  },
  cancelWorktreeCreation: async (
    request: WorktreeCreationCancelRequest
  ): Promise<WorktreeCreationCancelResult> => {
    const value = await ipcRenderer.invoke("pi67:worktree-environment-cancel", request) as unknown;
    if (!isWorktreeCreationCancelResult(value)) throw new Error("Invalid Worktree creation cancellation response.");
    return value;
  },
  advanceWorktreeEnvironment: async (
    request: WorktreeCreationAdvanceRequest
  ): Promise<WorktreeCreationAdvanceResult> => {
    const value = await ipcRenderer.invoke("pi67:worktree-environment-advance", request) as unknown;
    if (!isWorktreeCreationAdvanceResult(value)) {
      throw new Error("Worktree creation advance response is invalid.");
    }
    return value;
  },
  rollbackWorktreeEnvironment: async (
    request: WorktreeCreationRollbackRequest
  ): Promise<WorktreeCreationRollbackResult> => {
    const value = await ipcRenderer.invoke("pi67:worktree-environment-rollback", request) as unknown;
    if (!isWorktreeCreationRollbackResult(value)) {
      throw new Error("Worktree creation rollback response is invalid.");
    }
    return value;
  },
  loadComposerDraftState: (): Promise<ComposerDraftStateSnapshot> => (
    ipcRenderer.invoke("pi67:composer-draft-state-load")
  ),
  updateComposerDraftState: (state: ComposerDraftPersistedState): Promise<ComposerDraftStateSnapshot> => (
    ipcRenderer.invoke("pi67:composer-draft-state-update", state)
  ),
  loadWorkspaceFileState: (): Promise<WorkspaceFileStateSnapshot> => (
    ipcRenderer.invoke("pi67:workspace-file-state-load")
  ),
  updateWorkspaceFileState: (state: WorkspaceFilePersistedState): Promise<WorkspaceFileStateSnapshot> => (
    ipcRenderer.invoke("pi67:workspace-file-state-update", state)
  ),
  updateWorkbenchLayout: (layout: WorkbenchLayoutV5): Promise<WorkbenchStateV5> => (
    ipcRenderer.invoke("pi67:workbench-layout-update", layout)
  ),
  completeShutdownCheckpoint: (response: { requestId: string; succeeded: boolean }): Promise<boolean> => (
    ipcRenderer.invoke("pi67:renderer-shutdown-checkpoint-complete", response)
  ),
  pickAndAddWorkspace: (): Promise<WorkspaceDescriptor | undefined> => (
    ipcRenderer.invoke("pi67:workspace-pick-and-add")
  ),
  repairWorkspace: (workspaceId: string): Promise<WorkspaceDescriptor | undefined> => (
    ipcRenderer.invoke("pi67:workspace-repair", workspaceId)
  ),
  removeWorkspace: (workspaceId: string): Promise<WorkbenchStateV5> => (
    ipcRenderer.invoke("pi67:workspace-remove", workspaceId)
  ),
  reorderWorkspaces: (workspaceIds: string[]): Promise<WorkbenchStateV5> => (
    ipcRenderer.invoke("pi67:workspace-reorder", workspaceIds)
  ),
  selectWorkspace: (): Promise<string | undefined> => ipcRenderer.invoke("pi67:select-workspace"),
  selectSessionFile: (): Promise<string | undefined> => ipcRenderer.invoke("pi67:select-session-file"),
  getRecoverySnapshot: (): Promise<DesktopRecoverySnapshot> => ipcRenderer.invoke("pi67:recovery-snapshot"),
  saveDiagnostics: (request: SupportDiagnosticsExportRequest): Promise<string | undefined> => (
    ipcRenderer.invoke("pi67:save-diagnostics", request)
  ),
  showNativeNotification: (request: NativeNotificationRequest): Promise<boolean> => (
    ipcRenderer.invoke("pi67:native-notification-show", request)
  ),
  dismissNativeNotification: (notificationId: string): Promise<boolean> => (
    ipcRenderer.invoke("pi67:native-notification-dismiss", notificationId)
  ),
  requestOpenExternal: (url: string): Promise<boolean> => ipcRenderer.invoke("pi67:open-external", url),
  showWorkspaceEntryContextMenu: (
    entry: WorkspaceEntryRequest,
    includeManagement = false
  ): Promise<WorkspaceEntryContextAction | undefined> => (
    ipcRenderer.invoke("pi67:workspace-entry-menu", entry, includeManagement)
  ),
  revealWorkspaceEntry: (entry: WorkspaceEntryRequest): Promise<boolean> => (
    ipcRenderer.invoke("pi67:workspace-entry-reveal", entry)
  ),
  openWorkspaceEntryInDefaultApp: (entry: WorkspaceEntryRequest): Promise<boolean> => (
    ipcRenderer.invoke("pi67:workspace-entry-open-default", entry)
  ),
  copyWorkspaceEntryPath: (entry: WorkspaceEntryRequest, mode: "absolute" | "relative"): Promise<boolean> => (
    ipcRenderer.invoke("pi67:workspace-entry-copy", entry, mode)
  ),
  trashWorkspaceEntry: (entry: WorkspaceEntryRequest): Promise<boolean> => (
    ipcRenderer.invoke("pi67:workspace-entry-trash", entry)
  ),
  getPackageNetworkSnapshot: (): Promise<PackageNetworkSnapshot> => (
    ipcRenderer.invoke("pi67:package-network-snapshot")
  ),
  savePackageNetworkSettings: (settings: PackageNetworkSettings): Promise<PackageNetworkSnapshot> => (
    ipcRenderer.invoke("pi67:package-network-save", settings)
  ),
  resetPackageNetworkSettings: (): Promise<PackageNetworkSnapshot> => (
    ipcRenderer.invoke("pi67:package-network-reset")
  ),
  probePackageSources: (settings: PackageNetworkSettings): Promise<PackageNetworkSnapshot> => (
    ipcRenderer.invoke("pi67:package-network-probe", settings)
  ),
  getDesktopCapabilitySnapshot: (): Promise<DesktopCapabilitySnapshot> => (
    ipcRenderer.invoke("pi67:capability-snapshot")
  ),
  setupBrowser67: (): Promise<DesktopCapabilitySnapshot> => ipcRenderer.invoke("pi67:browser67-setup"),
  doctorBrowser67: (): Promise<DesktopCapabilitySnapshot> => ipcRenderer.invoke("pi67:browser67-doctor"),
  prepareBrowser67Extension: (): Promise<DesktopCapabilitySnapshot> => (
    ipcRenderer.invoke("pi67:browser67-extension-prepare")
  ),
  openBrowser67ExtensionPage: (browser: "chrome" | "edge"): Promise<boolean> => (
    ipcRenderer.invoke("pi67:browser67-extension-open-browser", browser)
  ),
  revealBrowser67Extension: (): Promise<boolean> => ipcRenderer.invoke("pi67:browser67-extension-reveal"),
  copyBrowser67ExtensionPath: (): Promise<boolean> => ipcRenderer.invoke("pi67:browser67-extension-copy"),
  verifyBrowser67Extension: (options: { startHub: boolean }): Promise<DesktopCapabilitySnapshot> => (
    ipcRenderer.invoke("pi67:browser67-extension-verify", options)
  ),
  getUpdateState: (): Promise<unknown> => ipcRenderer.invoke("pi67:update-state"),
  checkForUpdates: (): Promise<unknown> => ipcRenderer.invoke("pi67:update-check"),
  startUpdate: (): Promise<unknown> => ipcRenderer.invoke("pi67:update-start"),
  cancelUpdate: (): Promise<unknown> => ipcRenderer.invoke("pi67:update-cancel"),
  onUpdateStateChanged: (listener: (state: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state);
    ipcRenderer.on("pi67:update-state-changed", handler);
    return () => ipcRenderer.removeListener("pi67:update-state-changed", handler);
  },
  onAgentHostFailed: (listener: (state: DesktopAgentHostFailureState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopAgentHostFailureState) => listener(state);
    ipcRenderer.on("pi67:agent-host-failed", handler);
    return () => ipcRenderer.removeListener("pi67:agent-host-failed", handler);
  },
  onAgentHostStartup: (listener: (state: DesktopAgentHostStartupState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopAgentHostStartupState) => listener(state);
    ipcRenderer.on("pi67:agent-host-startup", handler);
    return () => ipcRenderer.removeListener("pi67:agent-host-startup", handler);
  },
  onPowerResume: (listener: () => void): (() => void) => {
    const handler = () => listener();
    ipcRenderer.on("pi67:power-resumed", handler);
    return () => ipcRenderer.removeListener("pi67:power-resumed", handler);
  },
  onNativeNotificationActivated: (
    listener: (activation: NativeNotificationActivation) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, activation: NativeNotificationActivation) => (
      listener(activation)
    );
    ipcRenderer.on("pi67:native-notification-activated", handler);
    return () => ipcRenderer.removeListener("pi67:native-notification-activated", handler);
  },
  onShutdownCheckpointRequested: (listener: (requestId: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (
        typeof value !== "object"
        || value === null
        || Array.isArray(value)
        || Object.keys(value).length !== 1
        || typeof (value as { requestId?: unknown }).requestId !== "string"
      ) return;
      const requestId = (value as { requestId: string }).requestId;
      if (requestId.length === 0 || requestId.length > 200) return;
      listener(requestId);
    };
    ipcRenderer.on("pi67:renderer-shutdown-checkpoint-requested", handler);
    return () => ipcRenderer.removeListener("pi67:renderer-shutdown-checkpoint-requested", handler);
  }
} satisfies Omit<DesktopSystemBridge, "stagePromptAttachments"> & {
  stagePromptAttachments(files: File[]): Promise<StagedPromptAttachmentResult[]>;
};

contextBridge.exposeInMainWorld("pi67", { system: systemBridge });

ipcRenderer.on("pi67:agent-port", (event, value: unknown) => {
  const transferredPort = event.ports[0];
  if (!transferredPort) return;
  const handoff = typeof value === "object" && value !== null
    ? value as { expectedOrigin?: unknown; appInstanceId?: unknown; hostEpoch?: unknown }
    : {};
  const expectedOrigin = handoff.expectedOrigin;
  if (
    typeof expectedOrigin !== "string"
    || !isTrustedRendererOrigin(expectedOrigin)
    || window.location.origin !== expectedOrigin
    || typeof handoff.appInstanceId !== "string"
    || handoff.appInstanceId.length === 0
    || !Number.isSafeInteger(handoff.hostEpoch)
    || Number(handoff.hostEpoch) < 0
  ) {
    transferredPort.close();
    return;
  }
  window.postMessage({
    source: "pi67-preload",
    type: "agent-port",
    appInstanceId: handoff.appInstanceId,
    hostEpoch: handoff.hostEpoch
  }, expectedOrigin, [transferredPort]);
});
