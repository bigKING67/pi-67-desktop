import { randomUUID } from "node:crypto";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, safeStorage } from "electron";
import { AgentHostSupervisor } from "./agent-host-supervisor.js";
import { createAgentHostStoragePaths } from "./agent-host-storage.js";
import { createApplicationShutdownController } from "./application-shutdown.js";
import { registerApplicationProtocol, registerAppSchemePrivileges } from "./app-protocol.js";
import { createMainWindow } from "./main-window.js";
import { registerPowerResumeRecovery } from "./power-resume.js";
import { resolveDesktopToolchain } from "./desktop-toolchain.js";
import {
  DesktopCapabilityService
} from "./desktop-capability-service.js";
import { resolveDesktopAgentDirectory } from "./desktop-agent-directory.js";
import { PackageNetworkSettingsStore } from "./package-network-settings.js";
import { PromptAttachmentStagingService } from "./prompt-attachment-staging.js";
import { TeamMcpSettingsStore } from "./team-mcp-settings.js";
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
import { WorkspaceFileStateStore } from "./workspace-file-state.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const rendererDirectory = normalize(join(currentDirectory, "../../renderer/dist"));
const agentHostEntry = normalize(join(currentDirectory, "../../agent-host/dist/index.mjs"));
const toolchainRoot = app.isPackaged
  ? join(process.resourcesPath, "toolchain")
  : normalize(join(currentDirectory, "../../../artifacts/toolchain/current"));
const capabilitiesRoot = app.isPackaged
  ? join(process.resourcesPath, "capabilities")
  : normalize(join(currentDirectory, "../../../artifacts/capabilities/current"));
const teamMcpResourcesRoot = app.isPackaged
  ? join(process.resourcesPath, "team-mcp")
  : normalize(join(currentDirectory, "../resources/team-mcp"));
const desktopToolchain = resolveDesktopToolchain(toolchainRoot, app.isPackaged);
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
let packageNetworkSettings: PackageNetworkSettingsStore | undefined;
let teamMcpSettings: TeamMcpSettingsStore | undefined;
let desktopCapabilities: DesktopCapabilityService | undefined;
let promptAttachments: PromptAttachmentStagingService | undefined;
let workspaceFileState: WorkspaceFileStateStore | undefined;
const appInstanceId = randomUUID();
const agentHostSupervisor = new AgentHostSupervisor({
  agentHostEntry,
  appInstanceId,
  expectedRendererOrigin,
  getStoragePaths: () => createAgentHostStoragePaths(app.getPath("userData")),
  getRuntimeEnvironment: () => {
    if (!packageNetworkSettings) throw new Error("Package network settings are not initialized.");
    if (!teamMcpSettings) throw new Error("Team MCP settings are not initialized.");
    if (!promptAttachments) throw new Error("Prompt attachment staging is not initialized.");
    return {
      toolchain: desktopToolchain,
      capabilitiesRoot,
      teamMcpResourcesRoot,
      teamMcpTokenPath: teamMcpSettings.tokenPath,
      packageNetworkSettingsPath: packageNetworkSettings.requestedSettingsPath,
      promptAttachmentRoot: promptAttachments.root,
      packaged: app.isPackaged,
      electronExecutable: process.execPath
    };
  },
  getMainWindow: () => mainWindow,
  rendererUrl
});
const applicationShutdown = createApplicationShutdownController({
  stopAgentHost: () => agentHostSupervisor.stop(),
  afterAgentHostStop: async () => {
    await promptAttachments?.cleanup();
  },
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
    packageNetworkSettings = new PackageNetworkSettingsStore(app.getPath("userData"));
    teamMcpSettings = new TeamMcpSettingsStore(app.getPath("userData"));
    promptAttachments = new PromptAttachmentStagingService(join(
      app.getPath("userData"),
      "runtime",
      "prompt-attachments",
      appInstanceId
    ));
    workspaceFileState = new WorkspaceFileStateStore(app.getPath("userData"), {
      encryption: {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(value)
      }
    });
    desktopCapabilities = new DesktopCapabilityService({
      capabilitiesRoot,
      agentDir: resolveDesktopAgentDirectory(),
      toolchain: desktopToolchain,
      packageNetworkSettings
    });
    await workbenchState.update(beginWorkbenchRun);
    const persistedWorkbench = (await workbenchState.load()).state;
    const refreshedWorkspaces = await Promise.all(
      persistedWorkbench.workspaces.map(refreshPersistedWorkspaceDescriptor)
    );
    await workbenchState.update((state) => replaceWorkspaceRegistrations(state, refreshedWorkspaces));
    registerSystemBridge({
      connectAgentHost: (replaceCurrent) => agentHostSupervisor.connect(replaceCurrent),
      restartAgentHost: () => agentHostSupervisor.restart(),
      getMainWindow: () => mainWindow,
      desktopToolchain,
      desktopCapabilities,
      packageNetworkSettings,
      teamMcpSettings,
      promptAttachments,
      workbenchState,
      workspaceFileState
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
