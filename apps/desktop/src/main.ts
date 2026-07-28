import { randomUUID } from "node:crypto";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { AgentHostSupervisor } from "./agent-host-supervisor.js";
import { createAgentHostStoragePaths } from "./agent-host-storage.js";
import { createApplicationShutdownController } from "./application-shutdown.js";
import { registerApplicationProtocol, registerAppSchemePrivileges } from "./app-protocol.js";
import { createMainWindow } from "./main-window.js";
import { registerPowerResumeRecovery } from "./power-resume.js";
import { redact } from "./redaction.js";
import { rendererOrigin, resolveRendererUrl } from "./renderer-security.js";
import { registerSystemBridge } from "./system-bridge.js";
import {
  beginWorkbenchRun,
  finishWorkbenchRun,
  replaceWorkspaceRegistrations,
  WorkbenchStateStore
} from "./workbench-state.js";
import { refreshPersistedWorkspaceDescriptor } from "./workspace-identity.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const rendererDirectory = normalize(join(currentDirectory, "../../renderer/dist"));
const agentHostEntry = normalize(join(currentDirectory, "../../agent-host/dist/index.mjs"));
const rendererUrl = resolveRendererUrl(app.isPackaged, process.env.PI67_RENDERER_DEV_URL);
const expectedRendererOrigin = rendererOrigin(rendererUrl);
const supportedTarget = (process.platform === "win32" && process.arch === "x64")
  || (process.platform === "darwin" && process.arch === "arm64");

registerAppSchemePrivileges();

if (!supportedTarget) {
  throw new Error(`π does not support ${process.platform}/${process.arch}.`);
}

let mainWindow: BrowserWindow | undefined;
let unregisterPowerResumeRecovery: (() => void) | undefined;
let workbenchState: WorkbenchStateStore | undefined;
const agentHostSupervisor = new AgentHostSupervisor({
  agentHostEntry,
  appInstanceId: randomUUID(),
  expectedRendererOrigin,
  getStoragePaths: () => createAgentHostStoragePaths(app.getPath("userData")),
  getMainWindow: () => mainWindow,
  rendererUrl
});
const applicationShutdown = createApplicationShutdownController({
  stopAgentHost: () => agentHostSupervisor.stop(),
  markCleanExit: async () => {
    if (workbenchState) await workbenchState.update(finishWorkbenchRun);
  },
  quit: () => app.quit(),
  onError: (error) => {
    console.error(redact(error instanceof Error ? error.message : String(error)));
  }
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  if (applicationShutdown.isShuttingDown() || !mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (hasSingleInstanceLock) {
  void app.whenReady().then(async () => {
    registerApplicationProtocol(rendererDirectory);
    workbenchState = new WorkbenchStateStore(app.getPath("userData"));
    await workbenchState.update(beginWorkbenchRun);
    const persistedWorkbench = (await workbenchState.load()).state;
    const refreshedWorkspaces = await Promise.all(
      persistedWorkbench.workspaces.map(refreshPersistedWorkspaceDescriptor)
    );
    await workbenchState.update((state) => replaceWorkspaceRegistrations(state, refreshedWorkspaces));
    registerSystemBridge({
      connectAgentHost: () => agentHostSupervisor.connect(),
      getMainWindow: () => mainWindow,
      workbenchState
    });
    unregisterPowerResumeRecovery = registerPowerResumeRecovery({
      getMainWindow: () => mainWindow
    });
    await openMainWindow();
  }).catch((error: unknown) => {
    if (applicationShutdown.isShuttingDown()) return;
    console.error(redact(error instanceof Error ? error.message : String(error)));
    app.exit(1);
  });
}

app.on("activate", () => {
  if (!applicationShutdown.isShuttingDown() && BrowserWindow.getAllWindows().length === 0) {
    void openMainWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => applicationShutdown.handleBeforeQuit(event));
app.once("will-quit", () => {
  unregisterPowerResumeRecovery?.();
  unregisterPowerResumeRecovery = undefined;
});

async function openMainWindow(): Promise<void> {
  if (applicationShutdown.isShuttingDown()) return;
  const window = createMainWindow({
    currentDirectory,
    isPackaged: app.isPackaged,
    rendererUrl,
    onDidFinishLoad: (loadedWindow) => {
      if (!applicationShutdown.isShuttingDown()) agentHostSupervisor.attachPort(loadedWindow);
    },
    onClosed: (closedWindow) => {
      if (mainWindow === closedWindow) mainWindow = undefined;
    }
  });
  mainWindow = window;
  await window.loadURL(rendererUrl);
}
