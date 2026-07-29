import { writeFile } from "node:fs/promises";
import {
  app,
  dialog,
  ipcMain,
  net,
  Notification,
  shell,
  type BrowserWindow
} from "electron";
import type { ManualUpdateState } from "./manual-update.js";
import type { DesktopToolchain } from "./desktop-toolchain.js";
import type { DesktopCapabilityService } from "./desktop-capability-service.js";
import type { PackageNetworkSettingsStore } from "./package-network-settings.js";
import { probePackageSources, unprobedPackageNetworkSnapshot } from "./package-source-probe.js";
import { redact } from "./redaction.js";
import { asExternalUrl, asNotification } from "./system-bridge-policy.js";
import {
  addOrRefreshWorkspace,
  removeWorkspaceRegistration,
  repairWorkspaceRegistration,
  reorderWorkspaceRegistrations,
  replaceWorkbenchLayout,
  WorkbenchStateStore
} from "./workbench-state.js";
import { createNativeWorkspaceDescriptor, type NativeWorkspaceDescriptor } from "./workspace-identity.js";

const manualUpdateChannel = "unsigned-preview" as const;

interface SystemBridgeOptions {
  connectAgentHost: (replaceCurrent?: boolean) => void;
  getMainWindow: () => BrowserWindow | undefined;
  desktopToolchain: DesktopToolchain;
  desktopCapabilities: DesktopCapabilityService;
  packageNetworkSettings: PackageNetworkSettingsStore;
  workbenchState: WorkbenchStateStore;
}

export function registerSystemBridge(options: SystemBridgeOptions): void {
  const workbenchState = options.workbenchState;
  let updateState: ManualUpdateState | undefined;
  let updateCheck: Promise<ManualUpdateState> | undefined;

  const currentUpdateState = (): ManualUpdateState => {
    if (!app.isPackaged) return disabledManualUpdateState(app.getVersion());
    updateState ??= initialManualUpdateState(app.getVersion());
    return updateState;
  };

  const pickAndRegisterWorkspace = async (): Promise<NativeWorkspaceDescriptor | undefined> => {
    const result = await dialog.showOpenDialog(options.getMainWindow()!, {
      title: "选择 Pi 工作区",
      properties: ["openDirectory", "createDirectory"]
    });
    const selectedPath = result.canceled ? undefined : result.filePaths[0];
    if (!selectedPath) return undefined;
    const selected = await createNativeWorkspaceDescriptor(selectedPath);
    let registered: NativeWorkspaceDescriptor | undefined;
    await workbenchState.update((state) => {
      const updated = addOrRefreshWorkspace(state, selected);
      registered = updated.workspace;
      return updated.state;
    });
    return registered;
  };

  ipcMain.handle("pi67:platform-info", () => ({
    platform: process.platform,
    architecture: process.arch,
    version: app.getVersion()
  }));
  ipcMain.handle("pi67:agent-host-connect", (_event, replaceCurrent: unknown) => (
    options.connectAgentHost(replaceCurrent === true)
  ));
  ipcMain.handle("pi67:workbench-load", async () => (await workbenchState.load()).state);
  ipcMain.handle("pi67:workbench-layout-update", (_event, value: unknown) => (
    workbenchState.update((state) => replaceWorkbenchLayout(state, value))
  ));
  ipcMain.handle("pi67:workspace-pick-and-add", pickAndRegisterWorkspace);
  ipcMain.handle("pi67:workspace-repair", async (_event, workspaceId: unknown) => {
    const id = assertWorkspaceId(workspaceId);
    const state = (await workbenchState.load()).state;
    const workspace = state.workspaces.find((candidate) => candidate.id === id);
    if (!workspace) throw new Error("Workspace registration was not found.");
    const result = await dialog.showOpenDialog(options.getMainWindow()!, {
      title: `重新选择 ${workspace.displayName} 的目录`,
      defaultPath: workspace.identity.canonicalPath,
      properties: ["openDirectory", "createDirectory"]
    });
    const selectedPath = result.canceled ? undefined : result.filePaths[0];
    if (!selectedPath) return undefined;
    const selected = await createNativeWorkspaceDescriptor(selectedPath);
    let repaired: NativeWorkspaceDescriptor | undefined;
    await workbenchState.update((current) => {
      const updated = repairWorkspaceRegistration(current, id, selected);
      repaired = updated.workspace;
      return updated.state;
    });
    return repaired;
  });
  ipcMain.handle("pi67:workspace-remove", (_event, workspaceId: unknown) => (
    workbenchState.update((state) => removeWorkspaceRegistration(state, assertWorkspaceId(workspaceId)))
  ));
  ipcMain.handle("pi67:workspace-reorder", (_event, workspaceIds: unknown) => (
    workbenchState.update((state) => reorderWorkspaceRegistrations(state, assertWorkspaceIds(workspaceIds)))
  ));
  // Keep the legacy string bridge for older call sites while Workbench V2 uses descriptors.
  ipcMain.handle("pi67:select-workspace", async () => (
    (await pickAndRegisterWorkspace())?.identity.canonicalPath
  ));
  ipcMain.handle("pi67:select-session-file", async () => {
    const result = await dialog.showOpenDialog(options.getMainWindow()!, {
      title: "导入 Pi JSONL session 到当前工作区",
      properties: ["openFile"],
      filters: [
        { name: "Pi JSONL session", extensions: ["jsonl"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("pi67:save-diagnostics", async (_event, content: unknown) => {
    if (typeof content !== "string" || content.length > 1_000_000) throw new Error("Invalid diagnostic payload.");
    const result = await dialog.showSaveDialog(options.getMainWindow()!, {
      title: "保存脱敏诊断",
      defaultPath: `pi67-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return undefined;
    await writeFile(result.filePath, redact(content), { encoding: "utf8", mode: 0o600 });
    return result.filePath;
  });
  ipcMain.handle("pi67:notify", (_event, value: unknown) => {
    const notification = asNotification(value);
    if (notification) new Notification(notification).show();
  });
  ipcMain.handle("pi67:open-external", async (_event, value: unknown) => {
    const target = asExternalUrl(value);
    if (!target) return false;
    const result = await dialog.showMessageBox(options.getMainWindow()!, {
      type: "question",
      title: "打开外部链接",
      message: "允许本次打开外部链接？",
      detail: target.toString(),
      buttons: ["允许本次打开", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (result.response !== 0) return false;
    await shell.openExternal(target.toString());
    return true;
  });
  ipcMain.handle("pi67:update-state", currentUpdateState);
  ipcMain.handle("pi67:package-network-snapshot", async () => (
    unprobedPackageNetworkSnapshot(
      options.desktopToolchain,
      await options.packageNetworkSettings.load()
    )
  ));
  ipcMain.handle("pi67:package-network-save", async (_event, value: unknown) => (
    unprobedPackageNetworkSnapshot(
      options.desktopToolchain,
      await options.packageNetworkSettings.save(value)
    )
  ));
  ipcMain.handle("pi67:package-network-reset", async () => (
    unprobedPackageNetworkSnapshot(
      options.desktopToolchain,
      await options.packageNetworkSettings.reset()
    )
  ));
  ipcMain.handle("pi67:package-network-probe", async () => (
    probePackageSources({
      toolchain: options.desktopToolchain,
      settings: await options.packageNetworkSettings.load(),
      fetcher: (input, init) => net.fetch(input, init)
    })
  ));
  ipcMain.handle("pi67:capability-snapshot", () => options.desktopCapabilities.snapshot());
  ipcMain.handle("pi67:browser67-setup", async () => {
    const result = await dialog.showMessageBox(options.getMainWindow()!, {
      type: "question",
      title: "准备 browser67 依赖",
      message: "允许本次下载并准备 browser67 运行依赖？",
      detail: "Desktop 将使用内置 Node/npm，并按照下载源设置依次尝试公共镜像和官方源。不会修改系统 Node、npm 或 Git。",
      buttons: ["允许本次准备", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    return result.response === 0
      ? options.desktopCapabilities.setupBrowser67()
      : options.desktopCapabilities.snapshot();
  });
  ipcMain.handle("pi67:browser67-doctor", () => options.desktopCapabilities.doctorBrowser67());
  ipcMain.handle("pi67:update-check", async () => {
    if (!app.isPackaged) return disabledManualUpdateState(app.getVersion());
    if (updateCheck) return updateCheck;

    const currentVersion = app.getVersion();
    const pendingCheck = import("./manual-update.js").then(({ checkForUnsignedPreviewUpdate }) => (
      checkForUnsignedPreviewUpdate({
        currentVersion,
        fetcher: (input, init) => net.fetch(input, init)
      })
    )).catch((error: unknown) => errorManualUpdateState(
      currentVersion,
      redact(error instanceof Error ? error.message : String(error))
    ));
    updateCheck = pendingCheck;
    try {
      updateState = await pendingCheck;
      return updateState;
    } finally {
      if (updateCheck === pendingCheck) updateCheck = undefined;
    }
  });
}

function initialManualUpdateState(currentVersion: string): ManualUpdateState {
  return { phase: "idle", channel: manualUpdateChannel, currentVersion };
}

function disabledManualUpdateState(currentVersion: string): ManualUpdateState {
  return { phase: "disabled", channel: manualUpdateChannel, currentVersion, detail: "Development build" };
}

function errorManualUpdateState(currentVersion: string, detail: string): ManualUpdateState {
  return { phase: "error", channel: manualUpdateChannel, currentVersion, detail: detail.slice(0, 500) };
}

function assertWorkspaceId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200 || !/^[A-Za-z0-9._:-]+$/u.test(value)) {
    throw new Error("Workspace id is invalid.");
  }
  return value;
}

function assertWorkspaceIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Workspace order is invalid.");
  return value.map(assertWorkspaceId);
}
