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
import { redact } from "./redaction.js";
import { asExternalUrl, asNotification } from "./system-bridge-policy.js";

const manualUpdateChannel = "unsigned-preview" as const;

interface SystemBridgeOptions {
  connectAgentHost: () => void;
  getMainWindow: () => BrowserWindow | undefined;
}

export function registerSystemBridge(options: SystemBridgeOptions): void {
  let updateState: ManualUpdateState | undefined;
  let updateCheck: Promise<ManualUpdateState> | undefined;

  const currentUpdateState = (): ManualUpdateState => {
    if (!app.isPackaged) return disabledManualUpdateState(app.getVersion());
    updateState ??= initialManualUpdateState(app.getVersion());
    return updateState;
  };

  ipcMain.handle("pi67:platform-info", () => ({
    platform: process.platform,
    architecture: process.arch,
    version: app.getVersion()
  }));
  ipcMain.handle("pi67:agent-host-connect", () => options.connectAgentHost());
  ipcMain.handle("pi67:select-workspace", async () => {
    const result = await dialog.showOpenDialog(options.getMainWindow()!, {
      title: "选择 Pi 工作区",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
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
