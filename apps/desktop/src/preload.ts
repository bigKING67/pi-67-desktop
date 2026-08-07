import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  DesktopCapabilitySnapshot,
  DesktopRecoverySnapshot,
  PackageNetworkSettings,
  PackageNetworkSnapshot,
  RuntimeDiagnostics,
  WorkspaceEntryContextAction,
  WorkspaceEntryRequest,
  WorkspaceFilePersistedState,
  WorkspaceFileStateSnapshot
} from "@pi67/protocol";
import { isTrustedRendererOrigin } from "./renderer-security.js";
import { stagePromptAttachmentsFromPreload } from "./prompt-attachment-preload.js";
import type { TeamMcpRevealResult, TeamMcpStatus } from "./team-mcp-settings.js";
import type {
  WorkbenchLayoutV4,
  WorkbenchStateV4
} from "./workbench-state.js";
import type { WorkspaceDescriptor } from "./workspace-identity.js";

export type {
  WorkbenchLayoutV4,
  WorkbenchStateV4,
} from "./workbench-state.js";
export type {
  NativeWorkspaceDescriptor,
  WorkspaceDescriptor,
  WorkspacePathIdentity
} from "./workspace-identity.js";

export interface PlatformInfo {
  platform: "win32" | "darwin";
  architecture: "x64" | "arm64";
  version: string;
}

const systemBridge = {
  getPlatformInfo: (): Promise<PlatformInfo> => ipcRenderer.invoke("pi67:platform-info"),
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
  loadWorkbenchState: (): Promise<WorkbenchStateV4> => ipcRenderer.invoke("pi67:workbench-load"),
  loadWorkspaceFileState: (): Promise<WorkspaceFileStateSnapshot> => (
    ipcRenderer.invoke("pi67:workspace-file-state-load")
  ),
  updateWorkspaceFileState: (state: WorkspaceFilePersistedState): Promise<WorkspaceFileStateSnapshot> => (
    ipcRenderer.invoke("pi67:workspace-file-state-update", state)
  ),
  updateWorkbenchLayout: (layout: WorkbenchLayoutV4): Promise<WorkbenchStateV4> => (
    ipcRenderer.invoke("pi67:workbench-layout-update", layout)
  ),
  pickAndAddWorkspace: (): Promise<WorkspaceDescriptor | undefined> => (
    ipcRenderer.invoke("pi67:workspace-pick-and-add")
  ),
  repairWorkspace: (workspaceId: string): Promise<WorkspaceDescriptor | undefined> => (
    ipcRenderer.invoke("pi67:workspace-repair", workspaceId)
  ),
  removeWorkspace: (workspaceId: string): Promise<WorkbenchStateV4> => (
    ipcRenderer.invoke("pi67:workspace-remove", workspaceId)
  ),
  reorderWorkspaces: (workspaceIds: string[]): Promise<WorkbenchStateV4> => (
    ipcRenderer.invoke("pi67:workspace-reorder", workspaceIds)
  ),
  selectWorkspace: (): Promise<string | undefined> => ipcRenderer.invoke("pi67:select-workspace"),
  selectSessionFile: (): Promise<string | undefined> => ipcRenderer.invoke("pi67:select-session-file"),
  getRecoverySnapshot: (): Promise<DesktopRecoverySnapshot> => ipcRenderer.invoke("pi67:recovery-snapshot"),
  saveDiagnostics: (diagnostics: RuntimeDiagnostics): Promise<string | undefined> => (
    ipcRenderer.invoke("pi67:save-diagnostics", diagnostics)
  ),
  showNotification: (title: string, body: string): Promise<void> => ipcRenderer.invoke("pi67:notify", { title, body }),
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
  getTeamMcpStatus: (): Promise<TeamMcpStatus> => ipcRenderer.invoke("pi67:team-mcp-status"),
  revealTeamMcpToken: (): Promise<TeamMcpRevealResult> => ipcRenderer.invoke("pi67:team-mcp-reveal"),
  saveTeamMcpToken: (token: string): Promise<TeamMcpStatus> => (
    ipcRenderer.invoke("pi67:team-mcp-save", token)
  ),
  clearTeamMcpToken: (): Promise<TeamMcpStatus> => ipcRenderer.invoke("pi67:team-mcp-clear"),
  getUpdateState: (): Promise<unknown> => ipcRenderer.invoke("pi67:update-state"),
  checkForUpdates: (): Promise<unknown> => ipcRenderer.invoke("pi67:update-check"),
  onUpdateStateChanged: (listener: (state: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state);
    ipcRenderer.on("pi67:update-state-changed", handler);
    return () => ipcRenderer.removeListener("pi67:update-state-changed", handler);
  },
  onAgentHostFailed: (listener: (state: { code: number; recoverable: boolean; attempt?: number }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { code: number; recoverable: boolean; attempt?: number }) => listener(state);
    ipcRenderer.on("pi67:agent-host-failed", handler);
    return () => ipcRenderer.removeListener("pi67:agent-host-failed", handler);
  },
  onPowerResume: (listener: () => void): (() => void) => {
    const handler = () => listener();
    ipcRenderer.on("pi67:power-resumed", handler);
    return () => ipcRenderer.removeListener("pi67:power-resumed", handler);
  }
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
