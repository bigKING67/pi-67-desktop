import { contextBridge, ipcRenderer } from "electron";

export interface PlatformInfo {
  platform: "win32" | "darwin";
  architecture: "x64" | "arm64";
  version: string;
}

const systemBridge = {
  getPlatformInfo: (): Promise<PlatformInfo> => ipcRenderer.invoke("pi67:platform-info"),
  connectAgentHost: (): Promise<void> => ipcRenderer.invoke("pi67:agent-host-connect"),
  selectWorkspace: (): Promise<string | undefined> => ipcRenderer.invoke("pi67:select-workspace"),
  selectSessionFile: (): Promise<string | undefined> => ipcRenderer.invoke("pi67:select-session-file"),
  saveDiagnostics: (content: string): Promise<string | undefined> => ipcRenderer.invoke("pi67:save-diagnostics", content),
  showNotification: (title: string, body: string): Promise<void> => ipcRenderer.invoke("pi67:notify", { title, body }),
  requestOpenExternal: (url: string): Promise<boolean> => ipcRenderer.invoke("pi67:open-external", url),
  getUpdateState: (): Promise<unknown> => ipcRenderer.invoke("pi67:update-state"),
  checkForUpdates: (): Promise<unknown> => ipcRenderer.invoke("pi67:update-check"),
  onAgentHostFailed: (listener: (state: { code: number; recoverable: boolean; attempt?: number }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { code: number; recoverable: boolean; attempt?: number }) => listener(state);
    ipcRenderer.on("pi67:agent-host-failed", handler);
    return () => ipcRenderer.removeListener("pi67:agent-host-failed", handler);
  }
};

contextBridge.exposeInMainWorld("pi67", { system: systemBridge });

ipcRenderer.on("pi67:agent-port", (event) => {
  const transferredPort = event.ports[0];
  if (!transferredPort) return;
  window.postMessage({ source: "pi67-preload", type: "agent-port" }, "*", [transferredPort]);
});
