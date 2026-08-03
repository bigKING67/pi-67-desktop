import type { Page } from "@playwright/test";
import type {
  RuntimeRecoveryRecord,
  SettingsSection,
  WorkbenchSurface
} from "../../packages/domain/src/index.js";
import {
  createMockDesktopCapabilitySnapshot,
  createMockPackageNetworkSnapshot
} from "./pi67-renderer-system-fixtures.js";

export interface MockWorkspaceDescriptor {
  id: string;
  displayName: string;
  identity: {
    canonicalPath: string;
    device?: string;
    inode?: string;
    birthtimeNs?: string;
    assurance: "filesystem" | "path-only";
  };
  trust: "unknown" | "trusted" | "untrusted";
  trustProvenance: "native-picker" | "user-confirmed" | "restored" | "identity-changed" | "indirect";
  availability: "available" | "missing" | "identity-changed" | "unavailable";
}

export interface MockDesktopBridgeOptions {
  initialWorkspaces?: MockWorkspaceDescriptor[];
  pickerQueue?: MockWorkspaceDescriptor[];
  initialRuntimeRecovery?: RuntimeRecoveryRecord[];
  expandedWorkspaceIds?: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  settings?: {
    section: SettingsSection;
    scope: "global" | "project";
    workspaceId?: string;
  };
  capabilityInitializingCalls?: number;
  deferInitialUpdateState?: boolean;
}

export const DEFAULT_MOCK_WORKSPACE: MockWorkspaceDescriptor = {
  id: "workspace-pi-demo",
  displayName: "pi-demo",
  identity: {
    canonicalPath: "/Users/test/Projects/pi-demo",
    device: "1",
    inode: "67",
    birthtimeNs: "1",
    assurance: "filesystem"
  },
  trust: "trusted",
  trustProvenance: "native-picker",
  availability: "available"
};

export async function installMockDesktopBridge(
  page: Page,
  options: MockDesktopBridgeOptions = {}
): Promise<void> {
  const fixture = {
    initialWorkspaces: options.initialWorkspaces ?? [],
    pickerQueue: options.pickerQueue ?? [DEFAULT_MOCK_WORKSPACE],
    initialRuntimeRecovery: options.initialRuntimeRecovery ?? [],
    expandedWorkspaceIds: options.expandedWorkspaceIds ?? [],
    currentWorkspaceId: options.currentWorkspaceId,
    selectedSurface: options.selectedSurface,
    settings: options.settings ?? { section: "general" as const, scope: "global" as const },
    capabilityInitializingCalls: options.capabilityInitializingCalls ?? 0,
    deferInitialUpdateState: options.deferInitialUpdateState ?? false,
    capabilitySnapshot: createMockDesktopCapabilitySnapshot(),
    packageNetworkSnapshot: createMockPackageNetworkSnapshot(),
    teamMcpStatus: {
      serverName: "tavily-bridge",
      url: "https://tavily.example.test/mcp",
      tokenEnv: "TAVILY_BRIDGE_MCP_TOKEN",
      tokenPath: "/Users/test/Library/Application Support/Pi-67 Desktop/team-mcp/tavily-bridge.token",
      configured: false,
      tokenPrefix: undefined as string | undefined
    }
  };
  await page.addInitScript((bridgeFixture) => {
    type FixtureWorkbenchState = {
      version: 2;
      workspaces: MockWorkspaceDescriptor[];
      workspaceOrder: string[];
      expandedWorkspaceIds: string[];
      currentWorkspaceId?: string;
      selectedSurface?: MockDesktopBridgeOptions["selectedSurface"];
      runtimeRecovery: RuntimeRecoveryRecord[];
      settings: NonNullable<MockDesktopBridgeOptions["settings"]>;
      cleanExit: boolean;
    };
    let pickerIndex = 0;
    let capabilitySnapshotCalls = 0;
    let promptAttachmentCounter = 0;
    let teamMcpToken: string | undefined;
    let updateState: Record<string, unknown> = {
      phase: "idle",
      channel: "unsigned-preview",
      currentVersion: "0.1.0-alpha.1",
      automaticChecks: true
    };
    const updateListeners = new Set<(state: unknown) => void>();
    let resolveInitialUpdateState: (() => void) | undefined;
    const initialUpdateStateGate = bridgeFixture.deferInitialUpdateState
      ? new Promise<void>((resolve) => { resolveInitialUpdateState = resolve; })
      : Promise.resolve();
    const updateTest = {
      checks: 0,
      openedUrls: [] as string[],
      allowOpen: false,
      finishInitialRead() {
        resolveInitialUpdateState?.();
        resolveInitialUpdateState = undefined;
      },
      emit(state: Record<string, unknown>) {
        updateState = structuredClone(state);
        for (const listener of updateListeners) listener(structuredClone(updateState));
      }
    };
    let workspaceFileState = { version: 1 as const, workspaces: [] as Array<Record<string, unknown>> };
    const workspaceEntryTest = {
      menus: [] as Array<Record<string, unknown>>,
      reveals: [] as Array<Record<string, unknown>>,
      defaultOpens: [] as Array<Record<string, unknown>>,
      copies: [] as Array<{ entry: Record<string, unknown>; kind: "absolute" | "relative" }>,
      trashes: [] as Array<Record<string, unknown>>
    };
    const settingsActionsTest = {
      packageSaves: [] as Array<Record<string, unknown>>,
      packageResets: 0,
      packageProbes: [] as Array<Record<string, unknown>>,
      mcpSaves: 0,
      mcpClears: 0,
      platformInfoCalls: 0
    };
    let teamMcpStatus = structuredClone(bridgeFixture.teamMcpStatus);
    let workbenchState: FixtureWorkbenchState = {
      version: 2 as const,
      workspaces: structuredClone(bridgeFixture.initialWorkspaces),
      workspaceOrder: bridgeFixture.initialWorkspaces.map((workspace) => workspace.id),
      expandedWorkspaceIds: structuredClone(bridgeFixture.expandedWorkspaceIds),
      ...(bridgeFixture.currentWorkspaceId ? { currentWorkspaceId: bridgeFixture.currentWorkspaceId } : {}),
      ...(bridgeFixture.selectedSurface ? { selectedSurface: structuredClone(bridgeFixture.selectedSurface) } : {}),
      runtimeRecovery: structuredClone(bridgeFixture.initialRuntimeRecovery),
      settings: structuredClone(bridgeFixture.settings),
      cleanExit: false
    };
    Object.defineProperty(window, "pi67", {
      configurable: false,
      value: {
        system: {
          getPlatformInfo: async () => {
            settingsActionsTest.platformInfoCalls += 1;
            return { platform: "darwin" as const, architecture: "arm64" as const, version: "0.1.0-alpha.1" };
          },
          connectAgentHost: async () => undefined,
          loadWorkbenchState: async () => structuredClone(workbenchState),
          loadWorkspaceFileState: async () => ({
            state: structuredClone(workspaceFileState),
            draftPersistence: "available" as const
          }),
          updateWorkspaceFileState: async (state: typeof workspaceFileState) => {
            workspaceFileState = structuredClone(state);
            return { state: structuredClone(workspaceFileState), draftPersistence: "available" as const };
          },
          updateWorkbenchLayout: async (layout: Record<string, unknown>) => {
            workbenchState = { ...workbenchState, ...structuredClone(layout) } as FixtureWorkbenchState;
            return structuredClone(workbenchState);
          },
          pickAndAddWorkspace: async () => {
            const workspace = bridgeFixture.pickerQueue[
              Math.min(pickerIndex, Math.max(bridgeFixture.pickerQueue.length - 1, 0))
            ];
            if (!workspace) return undefined;
            pickerIndex += 1;
            if (!workbenchState.workspaces.some((item) => item.id === workspace.id)) {
              workbenchState = {
                ...workbenchState,
                workspaces: [...workbenchState.workspaces, workspace],
                workspaceOrder: [...workbenchState.workspaceOrder, workspace.id],
                expandedWorkspaceIds: [...workbenchState.expandedWorkspaceIds, workspace.id],
                currentWorkspaceId: workspace.id
              };
            }
            return structuredClone(workspace);
          },
          removeWorkspace: async (workspaceId: string) => {
            const workspaceOrder = workbenchState.workspaceOrder.filter((id) => id !== workspaceId);
            const currentWorkspaceId = workbenchState.currentWorkspaceId === workspaceId
              ? workspaceOrder[0]
              : workbenchState.currentWorkspaceId;
            const selectedSurface = selectedWorkspaceId(workbenchState.selectedSurface) === workspaceId
              ? (currentWorkspaceId ? { kind: "workspace" as const, workspaceId: currentWorkspaceId } : undefined)
              : workbenchState.selectedSurface;
            workbenchState = {
              version: 2,
              workspaces: workbenchState.workspaces.filter((item) => item.id !== workspaceId),
              workspaceOrder,
              expandedWorkspaceIds: workbenchState.expandedWorkspaceIds.filter((id) => id !== workspaceId),
              ...(currentWorkspaceId ? { currentWorkspaceId } : {}),
              ...(selectedSurface ? { selectedSurface } : {}),
              runtimeRecovery: workbenchState.runtimeRecovery.filter((record) => (
                record.conversation.workspaceId !== workspaceId
              )),
              settings: workbenchState.settings.workspaceId === workspaceId
                ? { section: workbenchState.settings.section, scope: "global" }
                : workbenchState.settings,
              cleanExit: false
            };
            return structuredClone(workbenchState);
          },
          reorderWorkspaces: async (workspaceIds: string[]) => {
            workbenchState = { ...workbenchState, workspaceOrder: [...workspaceIds] };
            return structuredClone(workbenchState);
          },
          selectWorkspace: async () => (
            bridgeFixture.pickerQueue[Math.min(pickerIndex, Math.max(bridgeFixture.pickerQueue.length - 1, 0))]
              ?.identity.canonicalPath
          ),
          selectSessionFile: async () => "/Users/test/.pi/agent/sessions/demo.jsonl",
          saveDiagnostics: async () => "/tmp/pi67-diagnostics.json",
          showNotification: async () => undefined,
          stagePromptAttachments: async (files: File[]) => files.map((file) => ({
            id: `fixture_attachment_${++promptAttachmentCounter}`,
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            byteLength: file.size,
            kind: promptAttachmentKind(file)
          })),
          releasePromptAttachments: async () => undefined,
          getPackageNetworkSnapshot: async () => structuredClone(bridgeFixture.packageNetworkSnapshot),
          savePackageNetworkSettings: async (settings: Record<string, unknown>) => {
            settingsActionsTest.packageSaves.push(structuredClone(settings));
            return {
              ...structuredClone(bridgeFixture.packageNetworkSnapshot),
              settings: structuredClone(settings)
            };
          },
          resetPackageNetworkSettings: async () => {
            settingsActionsTest.packageResets += 1;
            return structuredClone(bridgeFixture.packageNetworkSnapshot);
          },
          probePackageSources: async (settings: Record<string, unknown>) => {
            settingsActionsTest.packageProbes.push(structuredClone(settings));
            return {
              ...structuredClone(bridgeFixture.packageNetworkSnapshot),
              settings: structuredClone(settings),
              checkedAt: 1_784_800_000_000,
              sources: bridgeFixture.packageNetworkSnapshot.sources.map((source) => ({
                ...source,
                status: "reachable",
                latencyMs: 36
              }))
            };
          },
          getDesktopCapabilitySnapshot: async () => {
            capabilitySnapshotCalls += 1;
            const snapshot = structuredClone(bridgeFixture.capabilitySnapshot);
            if (capabilitySnapshotCalls > bridgeFixture.capabilityInitializingCalls) return snapshot;
            return {
              ...snapshot,
              phase: "initializing",
              packages: snapshot.packages.map((entry) => ({ ...entry, installed: false })),
              bundledExtensions: snapshot.bundledExtensions.map((entry) => ({ ...entry, installed: false })),
              bundledSkills: snapshot.bundledSkills.map((entry) => ({ ...entry, installed: false })),
              bundledSkillSuites: snapshot.bundledSkillSuites.map((suite) => ({
                ...suite,
                skills: suite.skills.map((entry) => ({ ...entry, installed: false }))
              })),
              managedContext: { rules: "unavailable", agents: "unavailable" }
            };
          },
          setupBrowser67: async () => ({
            ...structuredClone(bridgeFixture.capabilitySnapshot),
            integrations: [{
              id: "browser67",
              displayName: "browser67",
              bundled: true,
              dependencyState: "prepared",
              extensionState: "not-prepared",
              doctorState: "degraded",
              availableBrowsers: ["chrome", "edge"],
              detail: "依赖与命令入口已验证；真实 managed browser 连接仍需独立检查。",
              preparedAt: 1_784_800_000_000,
              checkedAt: 1_784_800_000_000,
              registry: "https://registry.npmmirror.com"
            }]
          }),
          doctorBrowser67: async () => structuredClone(bridgeFixture.capabilitySnapshot),
          prepareBrowser67Extension: async () => ({
            ...structuredClone(bridgeFixture.capabilitySnapshot),
            integrations: [{
              id: "browser67",
              displayName: "browser67",
              bundled: true,
              dependencyState: "prepared",
              extensionState: "prepared",
              doctorState: "degraded",
              availableBrowsers: ["chrome", "edge"],
              detail: "扩展文件已准备；请在 Chrome 或 Edge 中加载后验证连接。",
              preparedAt: 1_784_800_000_000,
              extensionPreparedAt: 1_784_800_000_000,
              extensionCheckedAt: 1_784_800_000_000,
              registry: "https://registry.npmmirror.com"
            }]
          }),
          openBrowser67ExtensionPage: async () => true,
          revealBrowser67Extension: async () => true,
          copyBrowser67ExtensionPath: async () => true,
          verifyBrowser67Extension: async () => ({
            ...structuredClone(bridgeFixture.capabilitySnapshot),
            integrations: [{
              id: "browser67",
              displayName: "browser67",
              bundled: true,
              dependencyState: "prepared",
              extensionState: "connected",
              doctorState: "ready",
              availableBrowsers: ["chrome", "edge"],
              detail: "browser67 扩展身份与当前内置版本一致，真实受管浏览器连接已就绪。",
              preparedAt: 1_784_800_000_000,
              checkedAt: 1_784_800_000_100,
              extensionPreparedAt: 1_784_800_000_000,
              extensionCheckedAt: 1_784_800_000_100,
              registry: "https://registry.npmmirror.com"
            }]
          }),
          getTeamMcpStatus: async () => structuredClone(teamMcpStatus),
          revealTeamMcpToken: async () => teamMcpToken
            ? { status: "revealed", token: teamMcpToken }
            : { status: "missing" },
          saveTeamMcpToken: async (token: string) => {
            settingsActionsTest.mcpSaves += 1;
            teamMcpToken = token;
            teamMcpStatus = {
              ...teamMcpStatus,
              configured: true,
              tokenPrefix: `${token.split(".")[0] ?? "mcp"}…`
            };
            return structuredClone(teamMcpStatus);
          },
          clearTeamMcpToken: async () => {
            settingsActionsTest.mcpClears += 1;
            teamMcpToken = undefined;
            teamMcpStatus = {
              serverName: bridgeFixture.teamMcpStatus.serverName,
              url: bridgeFixture.teamMcpStatus.url,
              tokenEnv: bridgeFixture.teamMcpStatus.tokenEnv,
              tokenPath: bridgeFixture.teamMcpStatus.tokenPath,
              configured: false,
              tokenPrefix: undefined
            };
            return structuredClone(teamMcpStatus);
          },
          requestOpenExternal: async (url: string) => {
            updateTest.openedUrls.push(url);
            return updateTest.allowOpen;
          },
          showWorkspaceEntryContextMenu: async (entry: Record<string, unknown>) => {
            workspaceEntryTest.menus.push(structuredClone(entry));
            return entry.kind === "file" ? "pi67-open" as const : "reveal" as const;
          },
          revealWorkspaceEntry: async (entry: Record<string, unknown>) => {
            workspaceEntryTest.reveals.push(structuredClone(entry));
            return true;
          },
          openWorkspaceEntryInDefaultApp: async (entry: Record<string, unknown>) => {
            workspaceEntryTest.defaultOpens.push(structuredClone(entry));
            return true;
          },
          copyWorkspaceEntryPath: async (
            entry: Record<string, unknown>,
            kind: "absolute" | "relative"
          ) => {
            workspaceEntryTest.copies.push({ entry: structuredClone(entry), kind });
            return true;
          },
          trashWorkspaceEntry: async (entry: Record<string, unknown>) => {
            workspaceEntryTest.trashes.push(structuredClone(entry));
            return true;
          },
          getUpdateState: async () => {
            await initialUpdateStateGate;
            return structuredClone(updateState);
          },
          checkForUpdates: async () => {
            updateTest.checks += 1;
            updateState = {
              phase: "available",
              channel: "unsigned-preview",
              currentVersion: "0.1.0-alpha.1",
              version: "0.1.0-alpha.2",
              releaseUrl: "https://github.com/bigKING67/pi-67-desktop/releases/tag/v0.1.0-alpha.2",
              publishedAt: "2026-07-23T06:00:00.000Z",
              automaticChecks: true,
              checkedAt: "2026-08-03T08:00:00.000Z"
            };
            for (const listener of updateListeners) listener(structuredClone(updateState));
            return structuredClone(updateState);
          },
          onUpdateStateChanged: (listener: (state: unknown) => void) => {
            updateListeners.add(listener);
            return () => {
              updateListeners.delete(listener);
            };
          },
          onAgentHostFailed: () => () => undefined,
          onPowerResume: () => () => undefined
        }
      }
    });
    Object.defineProperty(window, "__pi67UpdateTest", {
      configurable: false,
      value: updateTest
    });
    Object.defineProperty(window, "__pi67WorkspaceEntryTest", {
      configurable: false,
      value: workspaceEntryTest
    });
    Object.defineProperty(window, "__pi67SettingsTest", {
      configurable: false,
      value: settingsActionsTest
    });

    function selectedWorkspaceId(surface: FixtureWorkbenchState["selectedSurface"]): string | undefined {
      if (surface?.kind === "workspace") return surface.workspaceId;
      if (surface?.kind === "conversation") return surface.conversation.workspaceId;
      return undefined;
    }

    function promptAttachmentKind(file: File) {
      const type = file.type.toLowerCase();
      const name = file.name.toLowerCase();
      if (type.startsWith("image/")) return "image";
      if (type.startsWith("audio/")) return "audio";
      if (type.startsWith("video/")) return "video";
      if (/zip|gzip|tar|7z|rar/u.test(type) || /\.(?:zip|tar|tgz|gz)$/u.test(name)) return "archive";
      if (type.startsWith("text/") || /pdf|word|excel|spreadsheet|presentation|opendocument|rtf|epub/u.test(type)) {
        return "document";
      }
      return "file";
    }

  }, fixture);
}
