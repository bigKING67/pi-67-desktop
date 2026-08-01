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
    capabilitySnapshot: createMockDesktopCapabilitySnapshot(),
    packageNetworkSnapshot: createMockPackageNetworkSnapshot()
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
          getPlatformInfo: async () => ({ platform: "darwin", architecture: "arm64", version: "0.1.0-alpha.1" }),
          connectAgentHost: async () => undefined,
          loadWorkbenchState: async () => structuredClone(workbenchState),
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
          savePackageNetworkSettings: async (settings: Record<string, unknown>) => ({
            ...structuredClone(bridgeFixture.packageNetworkSnapshot),
            settings: structuredClone(settings)
          }),
          resetPackageNetworkSettings: async () => structuredClone(bridgeFixture.packageNetworkSnapshot),
          probePackageSources: async () => ({
            ...structuredClone(bridgeFixture.packageNetworkSnapshot),
            checkedAt: 1_784_800_000_000,
            sources: bridgeFixture.packageNetworkSnapshot.sources.map((source) => ({
              ...source,
              status: "reachable",
              latencyMs: 36
            }))
          }),
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
              doctorState: "degraded",
              detail: "依赖与命令入口已验证；真实 managed browser 连接仍需独立检查。",
              preparedAt: 1_784_800_000_000,
              checkedAt: 1_784_800_000_000,
              registry: "https://registry.npmmirror.com"
            }]
          }),
          doctorBrowser67: async () => structuredClone(bridgeFixture.capabilitySnapshot),
          requestOpenExternal: async (url: string) => {
            const testWindow = window as unknown as {
              __pi67UpdateTest: { checks: number; openedUrls: string[]; allowOpen: boolean };
            };
            testWindow.__pi67UpdateTest.openedUrls.push(url);
            return testWindow.__pi67UpdateTest.allowOpen;
          },
          getUpdateState: async () => ({
            phase: "idle",
            channel: "unsigned-preview",
            currentVersion: "0.1.0-alpha.1"
          }),
          checkForUpdates: async () => {
            const testWindow = window as unknown as { __pi67UpdateTest: { checks: number } };
            testWindow.__pi67UpdateTest.checks += 1;
            return {
              phase: "available",
              channel: "unsigned-preview",
              currentVersion: "0.1.0-alpha.1",
              version: "0.1.0-alpha.2",
              releaseUrl: "https://github.com/bigKING67/pi-67-desktop/releases/tag/v0.1.0-alpha.2",
              publishedAt: "2026-07-23T06:00:00.000Z"
            };
          },
          onAgentHostFailed: () => () => undefined,
          onPowerResume: () => () => undefined
        }
      }
    });
    Object.defineProperty(window, "__pi67UpdateTest", {
      configurable: false,
      value: { checks: 0, openedUrls: [], allowOpen: false }
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
