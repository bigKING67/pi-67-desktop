import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopCapabilitySnapshot,
  PackageNetworkSettings,
  PackageNetworkSnapshot
} from "@pi67/protocol";
import { isTrustedRendererOrigin } from "./renderer-security.js";
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
  loadWorkbenchState: (): Promise<WorkbenchStateV2> => ipcRenderer.invoke("pi67:workbench-load"),
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
