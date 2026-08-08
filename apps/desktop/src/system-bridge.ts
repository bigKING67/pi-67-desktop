import { app, clipboard, dialog, ipcMain, Menu, net, Notification, shell, type BrowserWindow } from "electron";
import { ManualUpdateController } from "./manual-update-controller.js";
import type { DesktopToolchain } from "./desktop-toolchain.js";
import type { DesktopCapabilityService } from "./desktop-capability-service.js";
import type { PackageNetworkSettingsStore } from "./package-network-settings.js";
import { probePackageSources, unprobedPackageNetworkSnapshot } from "./package-source-probe.js";
import { redact } from "./redaction.js";
import type { TeamMcpSettingsStore } from "./team-mcp-settings.js";
import type { PromptAttachmentStagingService } from "./prompt-attachment-staging.js";
import {
  parsePackageNetworkSettings,
  type DesktopRecoverySnapshot,
  type PreviousRunExitStatus,
  type WorkspaceEntryContextAction
} from "@pi67/protocol";
import { createDesktopRecoverySnapshot } from "./desktop-recovery-snapshot.js";
import {
  addOrRefreshWorkspace,
  removeWorkspaceRegistration,
  repairWorkspaceRegistration,
  reorderWorkspaceRegistrations,
  replaceWorkbenchLayout,
  WorkbenchStateStore
} from "./workbench-state.js";
import { createNativeWorkspaceDescriptor, type NativeWorkspaceDescriptor } from "./workspace-identity.js";
import { resolveRegisteredWorkspaceEntry } from "./workspace-entry.js";
import type { WorkspaceFileStateStore } from "./workspace-file-state.js";
import type { ComposerDraftStateStore } from "./composer-draft-state.js";
import { NativeNotificationManager } from "./native-notification-manager.js";
import {
  openBrowser67ExtensionPage,
  type Browser67BrowserId
} from "./browser67-integration.js";
import {
  asExternalUrl,
  asNativeNotificationId,
  asNativeNotificationRequest,
  assertWorkspaceId,
  assertWorkspaceIds
} from "./system-bridge-policy.js";
import type { AgentHostSupervisorDiagnostics } from "./agent-host-supervisor.js";
import { registerSupportDiagnosticsBridge } from "./support-diagnostics.js";
import {
  registerRepositoryEnvironmentBridge,
  type RepositoryEnvironmentInspectionBridge,
  type RepositoryWorkingTreeBridge
} from "./repository-environment-bridge.js";
import {
  registerWorktreeCreationBridge,
  type WorktreeCreationBridge
} from "./worktree-creation-bridge.js";
import type { RepositoryMutationScheduler } from "./repository-mutation-scheduler.js";
import type { PromptStashImageStore } from "./prompt-stash-image-store.js";
import { registerPromptInputBridge } from "./prompt-input-bridge.js";
import type { BoundedPrivateGitRunner } from "./worktree-git-runner.js";

export interface SystemBridgeOptions {
  connectAgentHost: (replaceCurrent?: boolean) => void;
  restartAgentHost?: () => void;
  getMainWindow: () => BrowserWindow | undefined;
  activateMainWindow: () => Promise<BrowserWindow | undefined>;
  desktopToolchain: DesktopToolchain;
  desktopCapabilities: DesktopCapabilityService;
  packageNetworkSettings: PackageNetworkSettingsStore;
  teamMcpSettings: TeamMcpSettingsStore;
  promptAttachments: PromptAttachmentStagingService;
  promptStashImages: PromptStashImageStore;
  previousRunExit: PreviousRunExitStatus;
  workbenchState: WorkbenchStateStore;
  composerDraftState: ComposerDraftStateStore;
  workspaceFileState: WorkspaceFileStateStore;
  repositoryEnvironmentInspection: RepositoryEnvironmentInspectionBridge;
  repositoryWorkingTree: RepositoryWorkingTreeBridge;
  repositoryGitRunner: Pick<BoundedPrivateGitRunner, "diagnostics">;
  worktreeCreation: WorktreeCreationBridge;
  repositoryMutationScheduler: Pick<RepositoryMutationScheduler, "diagnostics" | "dispose">;
  agentDirectory: string;
  agentDirectorySource: "default" | "environment";
  getAgentHostDiagnostics: () => AgentHostSupervisorDiagnostics;
}
export interface SystemBridgeRegistration {
  handlePowerResume(): void;
  dispose(): void;
}
export function registerSystemBridge(options: SystemBridgeOptions): SystemBridgeRegistration {
  const workbenchState = options.workbenchState;
  const nativeNotifications = new NativeNotificationManager({
    isSupported: () => Notification.isSupported(),
    create: (presentation) => new Notification(presentation),
    activate: async (activation) => {
      const window = await options.activateMainWindow();
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
      window.webContents.send("pi67:native-notification-activated", activation);
    },
    onError: (error) => {
      console.error(redact(error instanceof Error ? error.message : String(error)));
    }
  });
  const updateController = new ManualUpdateController({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    fetcher: (input, init) => net.fetch(input, init),
    publish: (state) => {
      const window = options.getMainWindow();
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
      window.webContents.send("pi67:update-state-changed", state);
    },
    sanitizeError: (error) => redact(error instanceof Error ? error.message : String(error))
  });
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
  const recoverySnapshot = async (): Promise<DesktopRecoverySnapshot> => createDesktopRecoverySnapshot(
    (await workbenchState.load()).state,
    options.previousRunExit,
    await options.promptAttachments.diagnostics(),
    {
      agentHost: options.getAgentHostDiagnostics(),
      repository: {
        mutationScheduler: options.repositoryMutationScheduler.diagnostics(),
        gitRunner: options.repositoryGitRunner.diagnostics(),
        workingTree: options.repositoryWorkingTree.diagnostics()
      },
      promptStashImages: options.promptStashImages.diagnostics()
    }
  );
  registerSupportDiagnosticsBridge({
    agentDirectory: options.agentDirectory,
    agentDirectorySource: options.agentDirectorySource,
    getAgentHostDiagnostics: options.getAgentHostDiagnostics,
    getMainWindow: options.getMainWindow,
    recoverySnapshot
  });
  ipcMain.handle("pi67:platform-info", () => ({
    platform: process.platform,
    architecture: process.arch,
    version: app.getVersion()
  }));
  ipcMain.handle("pi67:agent-host-connect", (_event, replaceCurrent: unknown) => (
    options.connectAgentHost(replaceCurrent === true)
  ));
  registerPromptInputBridge(options.promptAttachments, options.promptStashImages);
  ipcMain.handle("pi67:workbench-load", async () => (await workbenchState.load()).state);
  registerRepositoryEnvironmentBridge(options.repositoryEnvironmentInspection, options.repositoryWorkingTree);
  registerWorktreeCreationBridge(options.worktreeCreation);
  ipcMain.handle("pi67:composer-draft-state-load", () => options.composerDraftState.load());
  ipcMain.handle("pi67:composer-draft-state-update", (_event, value: unknown) => (
    options.composerDraftState.update(value)
  ));
  ipcMain.handle("pi67:workspace-file-state-load", () => options.workspaceFileState.load());
  ipcMain.handle("pi67:workspace-file-state-update", (_event, value: unknown) => (
    options.workspaceFileState.update(value)
  ));
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
  ipcMain.handle("pi67:workspace-remove", async (_event, workspaceId: unknown) => {
    const id = assertWorkspaceId(workspaceId);
    const state = await workbenchState.update((current) => removeWorkspaceRegistration(current, id));
    await options.composerDraftState.removeWorkspace(id);
    await options.promptStashImages.removeWorkspace(id);
    await options.workspaceFileState.removeWorkspace(id);
    await options.repositoryEnvironmentInspection.removeWorkspace(id).catch(() => {
      console.warn("Worktree Catalog cleanup failed after Workspace removal.");
    });
    await options.repositoryWorkingTree.removeWorkspace(id);
    return state;
  });
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
  ipcMain.handle("pi67:recovery-snapshot", recoverySnapshot);
  ipcMain.handle("pi67:native-notification-show", (_event, value: unknown) => {
    const request = asNativeNotificationRequest(value);
    return request ? nativeNotifications.show(request) : false;
  });
  ipcMain.handle("pi67:native-notification-dismiss", (_event, value: unknown) => {
    const notificationId = asNativeNotificationId(value);
    return notificationId ? nativeNotifications.dismiss(notificationId) : false;
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
  ipcMain.handle("pi67:workspace-entry-menu", async (_event, value: unknown, includeManagementValue: unknown) => {
    if (includeManagementValue !== undefined && typeof includeManagementValue !== "boolean") {
      throw new Error("Workspace entry menu options are invalid.");
    }
    const includeManagement = includeManagementValue === true;
    const entry = await resolveRegisteredWorkspaceEntry(workbenchState, value);
    const window = options.getMainWindow();
    if (!window) return undefined;
    return new Promise<WorkspaceEntryContextAction | undefined>((resolveAction) => {
      let resolved = false;
      const choose = (action: WorkspaceEntryContextAction) => {
        resolved = true;
        resolveAction(action);
      };
      const template: Electron.MenuItemConstructorOptions[] = entry.kind === "file"
        ? [
            { label: "在 Pi-67 中打开", click: () => choose("pi67-open") },
            { type: "separator" },
            { label: "使用系统默认应用打开", click: () => choose("open-default") },
            { label: "复制相对路径", click: () => choose("copy-relative") },
            { label: "复制绝对路径", click: () => choose("copy-absolute") },
            { label: process.platform === "darwin" ? "在 Finder 中显示" : "在文件资源管理器中显示", click: () => choose("reveal") },
            ...(includeManagement ? [
              { type: "separator" as const },
              { label: "重命名", click: () => choose("rename") },
              { label: "移到废纸篓", click: () => choose("trash") }
            ] : [])
          ]
        : [
            { label: process.platform === "darwin" ? "在 Finder 中打开" : "在文件资源管理器中打开", click: () => choose("reveal") },
            { label: "复制相对路径", click: () => choose("copy-relative") },
            { label: "复制绝对路径", click: () => choose("copy-absolute") },
            ...(includeManagement ? [
              { type: "separator" as const },
              { label: "重命名", click: () => choose("rename") },
              { label: "移到废纸篓", click: () => choose("trash") }
            ] : [])
          ];
      Menu.buildFromTemplate(template).popup({
        window,
        callback: () => {
          if (!resolved) resolveAction(undefined);
        }
      });
    });
  });
  ipcMain.handle("pi67:workspace-entry-reveal", async (_event, value: unknown) => {
    const entry = await resolveRegisteredWorkspaceEntry(workbenchState, value);
    if (entry.kind === "file") shell.showItemInFolder(entry.absolutePath);
    else await openSystemPath(entry.absolutePath);
    return true;
  });
  ipcMain.handle("pi67:workspace-entry-open-default", async (_event, value: unknown) => {
    const entry = await resolveRegisteredWorkspaceEntry(workbenchState, value);
    await openSystemPath(entry.absolutePath);
    return true;
  });
  ipcMain.handle("pi67:workspace-entry-copy", async (_event, value: unknown, mode: unknown) => {
    if (mode !== "absolute" && mode !== "relative") throw new Error("Workspace path copy mode is invalid.");
    const entry = await resolveRegisteredWorkspaceEntry(workbenchState, value);
    clipboard.writeText(mode === "absolute" ? entry.absolutePath : entry.relativePath);
    return true;
  });
  ipcMain.handle("pi67:workspace-entry-trash", async (_event, value: unknown) => {
    const entry = await resolveRegisteredWorkspaceEntry(workbenchState, value);
    const result = await dialog.showMessageBox(options.getMainWindow()!, {
      type: "warning",
      title: "移到废纸篓",
      message: `将“${entry.relativePath}”移到废纸篓？`,
      detail: "可以从系统废纸篓恢复；Pi-67 不会执行永久删除。",
      buttons: ["移到废纸篓", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (result.response !== 0) return false;
    await shell.trashItem(entry.absolutePath);
    return true;
  });
  ipcMain.handle("pi67:update-state", () => updateController.getState());
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
  ipcMain.handle("pi67:package-network-probe", async (_event, value: unknown) => {
    const settings = parsePackageNetworkSettings(value);
    if (!settings) throw new Error("Package network settings are invalid.");
    return probePackageSources({
      toolchain: options.desktopToolchain,
      settings,
      fetcher: (input, init) => net.fetch(input, init)
    });
  });
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
  ipcMain.handle("pi67:browser67-extension-prepare", async () => {
    const result = await dialog.showMessageBox(options.getMainWindow()!, {
      type: "question",
      title: "安装 browser67 浏览器扩展",
      message: "允许本次准备 browser67 运行依赖和扩展文件？",
      detail: "可能按照下载源设置访问 npm，并将 unpacked extension 写入 browser67 活动目录。不会修改系统 Node/npm、浏览器策略或其他扩展；首次加载仍需你在 Chrome/Edge 中确认。",
      buttons: ["允许本次准备", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    return result.response === 0
      ? options.desktopCapabilities.prepareBrowser67Extension()
      : options.desktopCapabilities.snapshot();
  });
  ipcMain.handle("pi67:browser67-extension-open-browser", async (_event, value: unknown) => {
    if (value !== "chrome" && value !== "edge") throw new Error("Browser selection is invalid.");
    return openBrowser67ExtensionPage(value as Browser67BrowserId);
  });
  ipcMain.handle("pi67:browser67-extension-reveal", async () => {
    shell.showItemInFolder(await options.desktopCapabilities.browser67ExtensionManifestPath());
    return true;
  });
  ipcMain.handle("pi67:browser67-extension-copy", async () => {
    await options.desktopCapabilities.browser67ExtensionManifestPath();
    clipboard.writeText(options.desktopCapabilities.browser67ExtensionDirectory());
    return true;
  });
  ipcMain.handle("pi67:browser67-extension-verify", async (_event, value: unknown) => {
    if (
      !isRecord(value)
      || typeof value.startHub !== "boolean"
      || Object.keys(value).length !== 1
    ) {
      throw new Error("browser67 verification options are invalid.");
    }
    if (!value.startHub) return options.desktopCapabilities.verifyBrowser67Extension({ startHub: false });
    const result = await dialog.showMessageBox(options.getMainWindow()!, {
      type: "question",
      title: "启动 browser67 连接",
      message: "启动或复用本地 browser67 Hub 并验证扩展连接？",
      detail: "验证只接受当前内置扩展版本的 live identity。若扩展尚未在 Chrome/Edge 中加载，本次检查会保持为未就绪。",
      buttons: ["启动并验证", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    return result.response === 0
      ? options.desktopCapabilities.verifyBrowser67Extension({ startHub: true })
      : options.desktopCapabilities.snapshot();
  });
  ipcMain.handle("pi67:team-mcp-status", () => options.teamMcpSettings.status());
  ipcMain.handle("pi67:team-mcp-reveal", () => options.teamMcpSettings.revealToken());
  ipcMain.handle("pi67:team-mcp-save", async (_event, value: unknown) => {
    const status = await options.teamMcpSettings.saveToken(value);
    // Restart Agent Host so TAVILY_BRIDGE_MCP_TOKEN is re-read from userData.
    (options.restartAgentHost ?? (() => options.connectAgentHost(true)))();
    return status;
  });
  ipcMain.handle("pi67:team-mcp-clear", async () => {
    const status = await options.teamMcpSettings.clearToken();
    (options.restartAgentHost ?? (() => options.connectAgentHost(true)))();
    return status;
  });
  ipcMain.handle("pi67:update-check", () => updateController.checkNow());
  updateController.startAutomaticChecks();
  return {
    handlePowerResume: () => updateController.checkIfDue(),
    dispose: () => {
      nativeNotifications.dispose();
      updateController.dispose();
      options.repositoryMutationScheduler.dispose();
      options.repositoryEnvironmentInspection.dispose();
      options.repositoryWorkingTree.dispose();
      options.promptStashImages.dispose();
    }
  };
}

async function openSystemPath(path: string): Promise<void> {
  const failure = await shell.openPath(path);
  if (failure) throw new Error(failure);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
