import { randomUUID } from "node:crypto";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, safeStorage, screen } from "electron";
import { AgentHostSupervisor } from "./agent-host-supervisor.js";
import { createAgentHostStoragePaths } from "./agent-host-storage.js";
import { createApplicationShutdownController } from "./application-shutdown.js";
import { registerApplicationProtocol, registerAppSchemePrivileges } from "./app-protocol.js";
import { createMainWindow } from "./main-window.js";
import { observeStartupStage } from "./startup-stage-observer.js";
import {
  registerRendererShutdownCheckpoint,
  type RendererShutdownCheckpointRegistration
} from "./renderer-shutdown-checkpoint.js";
import { registerPowerResumeRecovery } from "./power-resume.js";
import { resolveDesktopToolchain } from "./desktop-toolchain.js";
import {
  DesktopCapabilityService
} from "./desktop-capability-service.js";
import { resolveDesktopAgentDirectory } from "./desktop-agent-directory.js";
import { previousRunExitStatus } from "./desktop-recovery-snapshot.js";
import { PackageNetworkSettingsStore } from "./package-network-settings.js";
import {
  cleanupStalePromptAttachmentRuns,
  PromptAttachmentStagingService
} from "./prompt-attachment-staging.js";
import { redact } from "./redaction.js";
import { removeRetiredTeamMcpToken } from "./retired-team-mcp-token.js";
import { rendererOrigin, resolveRendererUrl } from "./renderer-security.js";
import { registerSystemBridge, type SystemBridgeRegistration } from "./system-bridge.js";
import {
  beginWorkbenchRun,
  finishWorkbenchRun,
  replaceWorkspaceRegistrations,
  WorkbenchStateStore
} from "./workbench-state.js";
import { refreshPersistedWorkspaceDescriptor } from "./workspace-identity.js";
import { WorkspaceFileStateStore } from "./workspace-file-state.js";
import { ComposerDraftStateStore } from "./composer-draft-state.js";
import { BoundedPrivateGitRunner } from "./worktree-git-runner.js";
import { WorktreeCatalogStore } from "./worktree-catalog-store.js";
import { WorktreeCreationService } from "./worktree-creation-service.js";
import { WorktreeInspectionService } from "./worktree-inspection-service.js";
import { RepositoryWorkingTreeService } from "./repository-working-tree-service.js";
import { RepositoryWorktreeActionService } from "./repository-worktree-action-service.js";
import { RepositoryMutationScheduler } from "./repository-mutation-scheduler.js";
import { WorktreeStartupReconcileService } from "./worktree-startup-reconcile-service.js";
import { PromptStashImageStore } from "./prompt-stash-image-store.js";
import { ensureMainWindowContextRoom } from "./main-window-context-room.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const rendererDirectory = normalize(join(currentDirectory, "../../renderer/dist"));
const agentHostEntry = normalize(join(currentDirectory, "../../agent-host/dist/index.mjs"));
const toolchainRoot = app.isPackaged
  ? join(process.resourcesPath, "toolchain")
  : normalize(join(currentDirectory, "../../../artifacts/toolchain/current"));
const capabilitiesRoot = app.isPackaged
  ? join(process.resourcesPath, "capabilities")
  : normalize(join(currentDirectory, "../../../artifacts/capabilities/current"));
const windowsPackageWorkerJobController = process.platform === "win32"
  ? app.isPackaged
    ? join(process.resourcesPath, "native", "pi67-package-worker-job.exe")
    : normalize(join(
        currentDirectory,
        "../../../artifacts/native/windows-x64/pi67-package-worker-job.exe"
      ))
  : undefined;
const desktopToolchain = resolveDesktopToolchain(toolchainRoot, app.isPackaged);
const rendererUrl = resolveRendererUrl(app.isPackaged, process.env.PI67_RENDERER_DEV_URL);
const expectedRendererOrigin = rendererOrigin(rendererUrl);
const desktopAppId = "com.pi67.desktop";
const desktopAgentDirectory = resolveDesktopAgentDirectory();
const desktopAgentDirectorySource = process.env.PI_CODING_AGENT_DIR ? "environment" : "default";
const supportedTarget = (process.platform === "win32" && process.arch === "x64")
  || (process.platform === "darwin" && process.arch === "arm64");

registerAppSchemePrivileges();

if (!supportedTarget) {
  throw new Error(`π does not support ${process.platform}/${process.arch}.`);
}
if (process.platform === "win32") app.setAppUserModelId(desktopAppId);

let mainWindow: BrowserWindow | undefined;
let unregisterPowerResumeRecovery: (() => void) | undefined;
let workbenchState: WorkbenchStateStore | undefined;
let packageNetworkSettings: PackageNetworkSettingsStore | undefined;
let desktopCapabilities: DesktopCapabilityService | undefined;
let promptAttachments: PromptAttachmentStagingService | undefined;
let composerDraftState: ComposerDraftStateStore | undefined;
let promptStashImages: PromptStashImageStore | undefined;
let workspaceFileState: WorkspaceFileStateStore | undefined;
let systemBridgeRegistration: SystemBridgeRegistration | undefined;
let rendererShutdownCheckpoint: RendererShutdownCheckpointRegistration | undefined;
const appInstanceId = randomUUID();
const agentHostSupervisor = new AgentHostSupervisor({
  agentHostEntry,
  appInstanceId,
  expectedRendererOrigin,
  getStoragePaths: () => createAgentHostStoragePaths(app.getPath("userData")),
  getRuntimeEnvironment: () => {
    if (!packageNetworkSettings) throw new Error("Package network settings are not initialized.");
    if (!promptAttachments) throw new Error("Prompt attachment staging is not initialized.");
    return {
      agentDir: desktopAgentDirectory,
      toolchain: desktopToolchain,
      capabilitiesRoot,
      packageNetworkSettingsPath: packageNetworkSettings.requestedSettingsPath,
      promptAttachmentRoot: promptAttachments.root,
      packaged: app.isPackaged,
      electronExecutable: process.execPath,
      ...(windowsPackageWorkerJobController === undefined
        ? {}
        : { windowsPackageWorkerJobController })
    };
  },
  getMainWindow: () => mainWindow,
  rendererUrl
});
const applicationShutdown = createApplicationShutdownController({
  checkpointRenderer: (deadlineMs) => (
    rendererShutdownCheckpoint?.request(deadlineMs) ?? Promise.resolve(false)
  ),
  stopAgentHost: (deadlineMs) => agentHostSupervisor.stop(deadlineMs),
  afterAgentHostStop: async () => {
    await promptAttachments?.cleanup();
  },
  markCleanExit: async () => {
    if (workbenchState) await workbenchState.update(finishWorkbenchRun);
  },
  quit: () => app.quit(),
  onError: (error) => {
    console.error(redact(error instanceof Error ? error.message : String(error)));
  },
  onComplete: (report) => {
    console.info(`Application shutdown: ${JSON.stringify(report)}`);
  }
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  void activateMainWindow();
});

if (hasSingleInstanceLock) {
  void app.whenReady().then(async () => {
    registerApplicationProtocol(rendererDirectory);
    workbenchState = new WorkbenchStateStore(app.getPath("userData"));
    packageNetworkSettings = new PackageNetworkSettingsStore(app.getPath("userData"));
    const retiredTokenCleanup = await observeStartupStage("profile-retired-token", () => (
      removeRetiredTeamMcpToken(app.getPath("userData"))
    ));
    if (retiredTokenCleanup === "failed") {
      console.info("Retired Team MCP token cleanup failed; the token is not injected into Agent Host.");
    }
    const promptAttachmentParent = join(
      app.getPath("userData"),
      "runtime",
      "prompt-attachments"
    );
    promptAttachments = new PromptAttachmentStagingService(join(promptAttachmentParent, appInstanceId));
    void cleanupStalePromptAttachmentRuns(promptAttachmentParent, appInstanceId).then((result) => {
      if (result.removedRunCount === 0 && result.errorCount === 0) return;
      console.info(
        `Prompt attachment cleanup removed=${result.removedRunCount} errors=${result.errorCount}`
        + (result.errorClasses.length > 0 ? ` classes=${result.errorClasses.join(",")}` : "")
      );
    }).catch(() => {
      console.info("Prompt attachment cleanup removed=0 errors=1 classes=UnknownError");
    });
    workspaceFileState = new WorkspaceFileStateStore(app.getPath("userData"), {
      encryption: {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(value)
      }
    });
    composerDraftState = new ComposerDraftStateStore(app.getPath("userData"), {
      encryption: {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(value)
      }
    });
    promptStashImages = new PromptStashImageStore(app.getPath("userData"), {
      encryption: {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value),
        decrypt: (value) => safeStorage.decryptString(value)
      },
      staging: promptAttachments
    });
    desktopCapabilities = new DesktopCapabilityService({
      capabilitiesRoot,
      capabilityProjectionMode: app.isPackaged ? "packaged-direct" : "legacy-copy",
      agentDir: desktopAgentDirectory,
      toolchain: desktopToolchain,
      packageNetworkSettings
    });
    const initialWorkbenchLoad = await observeStartupStage(
      "workbench-load",
      () => workbenchState!.load()
    );
    const previousRunExit = previousRunExitStatus(initialWorkbenchLoad);
    await observeStartupStage("workbench-begin-run", () => workbenchState!.update(beginWorkbenchRun));
    const persistedWorkbench = (await observeStartupStage(
      "workbench-reload",
      () => workbenchState!.load()
    )).state;
    const refreshedWorkspaces = await observeStartupStage("workspace-refresh", () => Promise.all(
      persistedWorkbench.workspaces.map((workspace) => refreshPersistedWorkspaceDescriptor(workspace))
    ));
    await observeStartupStage("workspace-persist", () => workbenchState!.update(
      (state) => replaceWorkspaceRegistrations(state, refreshedWorkspaces)
    ));
    const privateGitRunner = new BoundedPrivateGitRunner(desktopToolchain);
    const repositoryMutationScheduler = new RepositoryMutationScheduler();
    try {
      const recovery = await observeStartupStage("worktree-reconcile", () => (
        new WorktreeStartupReconcileService({
          userData: app.getPath("userData"),
          runner: privateGitRunner,
          scheduler: repositoryMutationScheduler,
          workbenchState: workbenchState!
        }).reconcile()
      ));
      if (recovery.inspected > 0 || recovery.protected > 0 || recovery.indeterminate > 0) {
        console.info(
          `Worktree startup reconcile inspected=${recovery.inspected}`
          + ` resumed=${recovery.resumed} committed=${recovery.committed}`
          + ` failed=${recovery.failed} rolledBack=${recovery.rolledBack}`
          + ` protected=${recovery.protected} indeterminate=${recovery.indeterminate}`
        );
      }
    } catch {
      for (const record of persistedWorkbench.environmentMutations) {
        if (!["committed", "rolled-back", "failed"].includes(record.state)) {
          repositoryMutationScheduler.fence(record.repositoryGroupId);
        }
      }
      console.info("Worktree startup reconcile was not completed; incomplete repositories were fenced.");
    }
    const repositoryEnvironmentInspection = new WorktreeInspectionService({
      runner: privateGitRunner,
      workbenchState,
      catalog: new WorktreeCatalogStore(app.getPath("userData"))
    });
    const repositoryWorkingTree = new RepositoryWorkingTreeService({
      runner: privateGitRunner,
      workbenchState
    });
    const worktreeCreation = new WorktreeCreationService({
      userData: app.getPath("userData"),
      runner: privateGitRunner,
      scheduler: repositoryMutationScheduler,
      workbenchState,
      inspection: repositoryEnvironmentInspection
    });
    const repositoryWorktreeActions = new RepositoryWorktreeActionService({
      userData: app.getPath("userData"),
      runner: privateGitRunner,
      scheduler: repositoryMutationScheduler,
      workbenchState,
      inspection: repositoryEnvironmentInspection
    });
    systemBridgeRegistration = registerSystemBridge({
      connectAgentHost: (replaceCurrent) => agentHostSupervisor.connect(replaceCurrent),
      restartAgentHost: () => agentHostSupervisor.restart(),
      getMainWindow: () => mainWindow,
      ensureContextPanelRoom: () => {
        const window = mainWindow;
        if (!window || window.isDestroyed()) return false;
        return ensureMainWindowContextRoom(
          window,
          screen.getDisplayMatching(window.getBounds()).workArea
        );
      },
      activateMainWindow,
      desktopToolchain,
      desktopCapabilities,
      packageNetworkSettings,
      promptAttachments,
      promptStashImages,
      previousRunExit,
      workbenchState,
      composerDraftState,
      workspaceFileState,
      repositoryEnvironmentInspection,
      repositoryWorkingTree,
      repositoryWorktreeActions,
      repositoryGitRunner: privateGitRunner,
      worktreeCreation,
      repositoryMutationScheduler,
      agentDirectory: desktopAgentDirectory,
      agentDirectorySource: desktopAgentDirectorySource,
      getAgentHostDiagnostics: () => agentHostSupervisor.diagnostics()
    });
    rendererShutdownCheckpoint = registerRendererShutdownCheckpoint({
      getMainWindow: () => mainWindow
    });
    unregisterPowerResumeRecovery = registerPowerResumeRecovery({
      getMainWindow: () => mainWindow,
      onResume: () => systemBridgeRegistration?.handlePowerResume()
    });
    // Create the renderer target before macOS safeStorage restoration can wait on Keychain.
    const mainWindowReady = observeStartupStage("main-window", openMainWindow);
    const draftSnapshot = await observeStartupStage(
      "profile-composer-drafts",
      () => composerDraftState!.load()
    );
    await observeStartupStage("profile-prompt-stash", () => promptStashImages!.reconcile(new Set(
      draftSnapshot.state.drafts.flatMap((draft) => (
        (draft.promptStash ?? []).flatMap((item) => item.attachments?.length ? [item.id] : [])
      ))
    )));
    await mainWindowReady;
  }).catch((error: unknown) => {
    if (applicationShutdown.isShuttingDown()) return;
    console.error(redact(error instanceof Error ? error.message : String(error)));
    app.exit(1);
  });
}

app.on("activate", () => {
  if (!applicationShutdown.isShuttingDown() && BrowserWindow.getAllWindows().length === 0) {
    void activateMainWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => applicationShutdown.handleBeforeQuit(event));
app.once("will-quit", () => {
  rendererShutdownCheckpoint?.dispose();
  rendererShutdownCheckpoint = undefined;
  systemBridgeRegistration?.dispose();
  systemBridgeRegistration = undefined;
  unregisterPowerResumeRecovery?.();
  unregisterPowerResumeRecovery = undefined;
});

async function activateMainWindow(): Promise<BrowserWindow | undefined> {
  if (applicationShutdown.isShuttingDown()) return undefined;
  if (!mainWindow || mainWindow.isDestroyed()) await openMainWindow();
  const window = mainWindow;
  if (!window || window.isDestroyed()) return undefined;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}

async function openMainWindow(): Promise<BrowserWindow | undefined> {
  if (applicationShutdown.isShuttingDown()) return undefined;
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
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
  return window;
}
