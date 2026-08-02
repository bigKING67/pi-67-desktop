import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  DesktopCapabilitySnapshot,
  PackageNetworkSettings,
  PackageNetworkSnapshot,
  WorkspaceEntryContextAction,
  WorkspaceEntryRequest,
  WorkspaceFilePersistedState,
  WorkspaceFileStateSnapshot
} from "@pi67/protocol";
import { isTrustedRendererOrigin } from "./renderer-security.js";
import type { TeamMcpRevealResult, TeamMcpStatus } from "./team-mcp-settings.js";
import type {
  WorkbenchLayoutV2,
  WorkbenchStateV2
} from "./workbench-state.js";
import type { WorkspaceDescriptor } from "./workspace-identity.js";

export type {
  WorkbenchLayoutV2,
  WorkbenchStateV2,
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
  stagePromptAttachments: async (files: File[]) => ipcRenderer.invoke(
    "pi67:prompt-attachments-stage",
    await Promise.all(files.map(async (file) => {
      const path = webUtils.getPathForFile(file);
      return {
        name: file.name,
        mimeType: file.type,
        byteLength: file.size,
        lastModified: file.lastModified,
        ...(path ? { path } : { data: await file.arrayBuffer() })
      };
    }))
  ),
  releasePromptAttachments: (ids: string[]): Promise<void> => (
    ipcRenderer.invoke("pi67:prompt-attachments-release", ids)
  ),
  loadWorkbenchState: (): Promise<WorkbenchStateV2> => ipcRenderer.invoke("pi67:workbench-load"),
  loadWorkspaceFileState: (): Promise<WorkspaceFileStateSnapshot> => (
    ipcRenderer.invoke("pi67:workspace-file-state-load")
  ),
  updateWorkspaceFileState: (state: WorkspaceFilePersistedState): Promise<WorkspaceFileStateSnapshot> => (
    ipcRenderer.invoke("pi67:workspace-file-state-update", state)
  ),
  updateWorkbenchLayout: (layout: WorkbenchLayoutV2): Promise<WorkbenchStateV2> => (
    ipcRenderer.invoke("pi67:workbench-layout-update", layout)
  ),
  pickAndAddWorkspace: (): Promise<WorkspaceDescriptor | undefined> => (
    ipcRenderer.invoke("pi67:workspace-pick-and-add")
  ),
  repairWorkspace: (workspaceId: string): Promise<WorkspaceDescriptor | undefined> => (
    ipcRenderer.invoke("pi67:workspace-repair", workspaceId)
  ),
  removeWorkspace: (workspaceId: string): Promise<WorkbenchStateV2> => (
    ipcRenderer.invoke("pi67:workspace-remove", workspaceId)
  ),
  reorderWorkspaces: (workspaceIds: string[]): Promise<WorkbenchStateV2> => (
    ipcRenderer.invoke("pi67:workspace-reorder", workspaceIds)
  ),
  selectWorkspace: (): Promise<string | undefined> => ipcRenderer.invoke("pi67:select-workspace"),
  selectSessionFile: (): Promise<string | undefined> => ipcRenderer.invoke("pi67:select-session-file"),
  saveDiagnostics: (content: string): Promise<string | undefined> => ipcRenderer.invoke("pi67:save-diagnostics", content),
  showNotification: (title: string, body: string): Promise<void> => ipcRenderer.invoke("pi67:notify", { title, body }),
  requestOpenExternal: (url: string): Promise<boolean> => ipcRenderer.invoke("pi67:open-external", url),
  showWorkspaceEntryContextMenu: (entry: WorkspaceEntryRequest): Promise<WorkspaceEntryContextAction | undefined> => (
    ipcRenderer.invoke("pi67:workspace-entry-menu", entry)
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
  probePackageSources: (): Promise<PackageNetworkSnapshot> => (
    ipcRenderer.invoke("pi67:package-network-probe")
  ),
  getDesktopCapabilitySnapshot: (): Promise<DesktopCapabilitySnapshot> => (
    ipcRenderer.invoke("pi67:capability-snapshot")
  ),
  setupBrowser67: (): Promise<DesktopCapabilitySnapshot> => ipcRenderer.invoke("pi67:browser67-setup"),
  doctorBrowser67: (): Promise<DesktopCapabilitySnapshot> => ipcRenderer.invoke("pi67:browser67-doctor"),
  getTeamMcpStatus: (): Promise<TeamMcpStatus> => ipcRenderer.invoke("pi67:team-mcp-status"),
  revealTeamMcpToken: (): Promise<TeamMcpRevealResult> => ipcRenderer.invoke("pi67:team-mcp-reveal"),
  saveTeamMcpToken: (token: string): Promise<TeamMcpStatus> => (
    ipcRenderer.invoke("pi67:team-mcp-save", token)
  ),
  clearTeamMcpToken: (): Promise<TeamMcpStatus> => ipcRenderer.invoke("pi67:team-mcp-clear"),
  getUpdateState: (): Promise<unknown> => ipcRenderer.invoke("pi67:update-state"),
  checkForUpdates: (): Promise<unknown> => ipcRenderer.invoke("pi67:update-check"),
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
