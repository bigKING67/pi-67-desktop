import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, normalize, relative } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  net,
  nativeTheme,
  Notification,
  protocol,
  shell,
  utilityProcess,
  type UtilityProcess
} from "electron";
import type { AppUpdater } from "electron-updater";
import { redact } from "./redaction.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const rendererDirectory = normalize(join(currentDirectory, "../../renderer/dist"));
const agentHostEntry = normalize(join(currentDirectory, "../../agent-host/dist/index.mjs"));
const devServerUrl = process.env.PI67_RENDERER_DEV_URL;
const supportedTarget = (process.platform === "win32" && process.arch === "x64")
  || (process.platform === "darwin" && process.arch === "arm64");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true
    }
  }
]);

let mainWindow: BrowserWindow | undefined;
let agentHost: UtilityProcess | undefined;
let stopping = false;
let restartHistory: number[] = [];
let updateState: Record<string, unknown> = { phase: "idle" };
let updaterLoad: Promise<AppUpdater> | undefined;

if (!supportedTarget) {
  throw new Error(`Pi-67 Desktop does not support ${process.platform}/${process.arch}.`);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (hasSingleInstanceLock) {
  void app.whenReady().then(async () => {
    registerApplicationProtocol();
    registerSystemBridge();
    await createWindow();
  }).catch((error: unknown) => {
    console.error(redact(error instanceof Error ? error.message : String(error)));
    app.exit(1);
  });
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopping = true;
  agentHost?.kill();
});

async function createWindow(): Promise<void> {
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    title: "Pi-67 Desktop",
    width: 1440,
    height: 920,
    minWidth: 760,
    minHeight: 600,
    show: false,
    backgroundColor: "#111412",
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac ? {} : {
      titleBarOverlay: titleBarOverlay()
    }),
    webPreferences: {
      preload: join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, target) => {
    const allowedOrigin = devServerUrl ? new URL(devServerUrl).origin : "app://pi67";
    try {
      if (new URL(target).origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("did-finish-load", attachAgentPort);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const updateTitleBar = () => mainWindow?.setTitleBarOverlay(titleBarOverlay());
  nativeTheme.on("updated", updateTitleBar);
  mainWindow.on("closed", () => {
    nativeTheme.off("updated", updateTitleBar);
    mainWindow = undefined;
  });

  if (devServerUrl) await mainWindow.loadURL(devServerUrl);
  else await mainWindow.loadURL("app://pi67/index.html");
}

function registerApplicationProtocol(): void {
  protocol.handle("app", (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.hostname !== "pi67") return new Response("Not found", { status: 404 });
    const requestedPath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const filePath = normalize(join(rendererDirectory, requestedPath.replace(/^[/\\]+/u, "")));
    const escapePath = relative(rendererDirectory, filePath);
    if (escapePath.startsWith("..") || escapePath.includes(`..${process.platform === "win32" ? "\\" : "/"}`)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function startAgentHost(): void {
  if (agentHost) return;
  agentHost = utilityProcess.fork(agentHostEntry, [], {
    serviceName: "Pi-67 Agent Host",
    stdio: "pipe",
    env: {
      ...process.env,
      PI67_DESKTOP: "1",
      PI_TELEMETRY: "0"
    }
  });
  agentHost.on("spawn", attachAgentPort);
  agentHost.on("exit", (code) => {
    agentHost = undefined;
    if (stopping) return;
    const now = Date.now();
    restartHistory = restartHistory.filter((timestamp) => now - timestamp < 60_000);
    if (restartHistory.length >= 3) {
      mainWindow?.webContents.send("pi67:agent-host-failed", { code, recoverable: false });
      return;
    }
    restartHistory.push(now);
    const delay = Math.min(4_000, 500 * 2 ** (restartHistory.length - 1));
    mainWindow?.webContents.send("pi67:agent-host-failed", { code, recoverable: true, attempt: restartHistory.length });
    setTimeout(startAgentHost, delay);
  });
  agentHost.stdout?.on("data", () => undefined);
  agentHost.stderr?.on("data", (chunk) => {
    if (process.env.PI67_DEBUG_AGENT_STDERR !== "1") return;
    const message = redact(String(chunk)).slice(0, 2_000);
    if (message) console.error(`[agent-host] ${message}`);
  });
}

function attachAgentPort(): void {
  if (!agentHost || !mainWindow || mainWindow.isDestroyed()) return;
  const { port1, port2 } = new MessageChannelMain();
  agentHost.postMessage({ type: "attach-port" }, [port1]);
  mainWindow.webContents.postMessage("pi67:agent-port", { protocolVersion: 1 }, [port2]);
}

function registerSystemBridge(): void {
  ipcMain.handle("pi67:platform-info", () => ({
    platform: process.platform,
    architecture: process.arch,
    version: app.getVersion()
  }));
  ipcMain.handle("pi67:agent-host-connect", () => {
    startAgentHost();
  });
  ipcMain.handle("pi67:select-workspace", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "选择 Pi 工作区",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("pi67:select-session-file", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
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
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "保存脱敏诊断",
      defaultPath: `pi67-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return undefined;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(result.filePath, redact(content), { encoding: "utf8", mode: 0o600 });
    return result.filePath;
  });
  ipcMain.handle("pi67:notify", (_event, value: unknown) => {
    const notification = asNotification(value);
    if (!notification) return;
    new Notification(notification).show();
  });
  ipcMain.handle("pi67:open-external", async (_event, value: unknown) => {
    if (typeof value !== "string") return false;
    let target: URL;
    try {
      target = new URL(value);
    } catch {
      return false;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") return false;
    const result = await dialog.showMessageBox(mainWindow!, {
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
  ipcMain.handle("pi67:update-state", () => updateState);
  ipcMain.handle("pi67:update-check", async () => {
    if (!app.isPackaged) return { phase: "disabled", detail: "Development build" };
    await (await getUpdater()).checkForUpdates();
    return updateState;
  });
  ipcMain.handle("pi67:update-download", async () => (await getUpdater()).downloadUpdate());
  ipcMain.handle("pi67:update-install", async () => {
    stopping = true;
    (await getUpdater()).quitAndInstall(false, true);
  });
}

async function getUpdater(): Promise<AppUpdater> {
  updaterLoad ??= import("electron-updater").then((module) => {
    const updater = module.autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on("checking-for-update", () => setUpdateState({ phase: "checking" }));
    updater.on("update-available", (info) => setUpdateState({ phase: "available", version: info.version }));
    updater.on("update-not-available", () => setUpdateState({ phase: "current" }));
    updater.on("download-progress", (progress) => setUpdateState({ phase: "downloading", percent: progress.percent }));
    updater.on("update-downloaded", (info) => setUpdateState({ phase: "downloaded", version: info.version }));
    updater.on("error", (error) => setUpdateState({ phase: "error", detail: redact(error.message) }));
    return updater;
  }).catch((error: unknown) => {
    updaterLoad = undefined;
    throw error;
  });
  return updaterLoad;
}

function setUpdateState(state: Record<string, unknown>): void {
  updateState = state;
  mainWindow?.webContents.send("pi67:update-state-changed", state);
}

function asNotification(value: unknown): { title: string; body: string } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.title !== "string" || typeof record.body !== "string") return undefined;
  return { title: record.title.slice(0, 120), body: record.body.slice(0, 500) };
}

function titleBarOverlay(): { color: string; symbolColor: string; height: number } {
  return nativeTheme.shouldUseDarkColors
    ? { color: "#111412", symbolColor: "#f0f3ef", height: 42 }
    : { color: "#f5f6f4", symbolColor: "#171a18", height: 42 };
}
