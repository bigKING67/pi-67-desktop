import type { Page } from "@playwright/test";
import type {
  RuntimeRecoveryRecord,
  SettingsSection,
  WorkbenchSurface
} from "../../packages/domain/src/index.js";

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
    capabilityInitializingCalls: options.capabilityInitializingCalls ?? 0
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
          getPackageNetworkSnapshot: async () => packageNetworkSnapshot(),
          savePackageNetworkSettings: async (settings: Record<string, unknown>) => ({
            ...packageNetworkSnapshot(),
            settings: structuredClone(settings)
          }),
          resetPackageNetworkSettings: async () => packageNetworkSnapshot(),
          probePackageSources: async () => ({
            ...packageNetworkSnapshot(),
            checkedAt: 1_784_800_000_000,
            sources: packageNetworkSnapshot().sources.map((source) => ({
              ...source,
              status: "reachable",
              latencyMs: 36
            }))
          }),
          getDesktopCapabilitySnapshot: async () => {
            capabilitySnapshotCalls += 1;
            const snapshot = capabilitySnapshot();
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
            ...capabilitySnapshot(),
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
          doctorBrowser67: async () => capabilitySnapshot(),
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

    function packageNetworkSnapshot() {
      return {
        settings: { npmMode: "automatic", gitMode: "automatic", gitMirrors: ["gitclone", "ghproxy"] },
        toolchain: {
          ready: true,
          packaged: false,
          platform: "darwin",
          architecture: "arm64",
          nodeVersion: "24.18.0",
          npmVersion: "12.0.1",
          gitVersion: "2.53.0"
        },
        sources: [
          { id: "npm-public-mirror", kind: "npm", role: "public-mirror", url: "https://registry.npmmirror.com", status: "not-checked" },
          { id: "npm-official", kind: "npm", role: "official", url: "https://registry.npmjs.org", status: "not-checked" },
          { id: "git-gitclone", kind: "git", role: "public-mirror", url: "https://gitclone.com/github.com/arpagon/pi-rewind.git", status: "not-checked" },
          { id: "git-official", kind: "git", role: "official", url: "https://github.com/arpagon/pi-rewind.git", status: "not-checked" }
        ]
      };
    }

    function capabilitySnapshot() {
      const bundledSkills = [{
        id: "lark-doc",
        displayName: "lark-doc",
        description: "读取、创建和编辑飞书云文档。",
        packageId: "pi67-core",
        packageDisplayName: "Pi-67 Core",
        version: "0.15.8",
        installed: true
      }, {
        id: "lark-calendar",
        displayName: "lark-calendar",
        description: "管理飞书日历、日程、忙闲状态和会议室。",
        packageId: "pi67-core",
        packageDisplayName: "Pi-67 Core",
        version: "0.15.8",
        installed: true
      }, {
        id: "investment-research",
        displayName: "investment-research",
        description: "投资研究综合分析框架。",
        packageId: "pi67-core",
        packageDisplayName: "Pi-67 Core",
        version: "0.15.8",
        installed: true
      }, {
        id: "commerce-growth-os",
        displayName: "commerce-growth-os",
        description: "全域电商经营综合诊断和增长方案。",
        packageId: "commerce-growth-os",
        packageDisplayName: "commerce-growth-os",
        version: "2.2.0",
        installed: true
      }, {
        id: "browser67",
        displayName: "browser67",
        description: "真实浏览器运行和自动化能力。",
        packageId: "browser67",
        packageDisplayName: "browser67",
        version: "0.4.0",
        installed: true
      }, {
        id: "js-reverse",
        displayName: "js-reverse",
        description: "浏览器 JavaScript 逆向和证据化分析。",
        packageId: "browser67",
        packageDisplayName: "browser67",
        version: "0.4.0",
        installed: true
      }, {
        id: "design-craft",
        displayName: "design-craft",
        description: "产品界面和交互设计工程能力。",
        packageId: "design-craft",
        packageDisplayName: "design-craft",
        version: "0.5.6",
        installed: true
      }, {
        id: "minimalist-ui",
        displayName: "minimalist-ui",
        description: "简洁的编辑式界面设计方向。",
        packageId: "pi67-core",
        packageDisplayName: "Pi-67 Core",
        version: "0.15.8",
        installed: true
      }];
      return {
        phase: "ready",
        catalogVersion: "2026.07.31.2",
        packages: [{
          id: "pi67-core",
          displayName: "Pi-67 Core",
          origin: "first-party",
          bundled: true,
          defaultEnabled: true,
          version: "0.15.8",
          commit: "500f3f63a14d80b0297a1dcc04237b5e2cf87894",
          resourceTypes: ["extension", "skill", "prompt", "rule"],
          installed: true
        }, {
          id: "browser67",
          displayName: "browser67",
          origin: "first-party",
          bundled: true,
          defaultEnabled: true,
          version: "0.4.0",
          commit: "952ef19255f4aa1de535e114dc395eec5c9f0819",
          resourceTypes: ["skill", "integration"],
          installed: true
        }, {
          id: "design-craft",
          displayName: "design-craft",
          origin: "first-party",
          bundled: true,
          defaultEnabled: true,
          version: "0.5.6",
          commit: "9a90f15ea9e4dd6104cbd2ba2976e8603fee396e",
          resourceTypes: ["skill"],
          installed: true
        }, {
          id: "commerce-growth-os",
          displayName: "commerce-growth-os",
          origin: "first-party",
          bundled: true,
          defaultEnabled: true,
          version: "2.2.0",
          commit: "1c28f48ef002ce7dea18bbf5746eb9b4c2876971",
          resourceTypes: ["skill"],
          installed: true
        }],
        bundledExtensions: [
          "pi-hy-memory",
          "pi-rules-loader",
          "pi-vision-bridge",
          "xtalpi-pi-tools"
        ].map((id) => ({
          id,
          displayName: id,
          packageId: "pi67-core",
          packageDisplayName: "Pi-67 Core",
          version: "0.15.8",
          installed: true
        })),
        bundledSkills,
        bundledSkillSuites: [{
          id: "lark-cli",
          displayName: "飞书 Lark CLI",
          description: "飞书文档、消息、日历、任务、会议和开放平台能力。",
          skills: bundledSkills.slice(0, 2)
        }, {
          id: "ai-berkshire-investment-suite",
          displayName: "AI Berkshire 投资研究",
          description: "公司研究、财务分析和组合管理能力。",
          skills: bundledSkills.slice(2, 3)
        }, {
          id: "commerce-growth-os",
          displayName: "Commerce Growth OS",
          description: "电商经营、品牌、内容、增长和经营分析能力。",
          skills: bundledSkills.slice(3, 4)
        }, {
          id: "browser67",
          displayName: "browser67",
          description: "真实浏览器操作、诊断和 JavaScript 逆向能力。",
          skills: bundledSkills.slice(4, 6)
        }, {
          id: "design-output-tools",
          displayName: "设计与输出工具",
          description: "产品设计、视觉方向和完整输出能力。",
          skills: bundledSkills.slice(6, 8)
        }],
        recommendedExternal: [{ id: "pi-subagents", source: "npm:pi-subagents", recommendedVersion: "0.34.0" }],
        managedContext: { rules: "installed", agents: "user-owned" },
        integrations: [{
          id: "browser67",
          displayName: "browser67",
          bundled: true,
          dependencyState: "not-prepared",
          doctorState: "not-checked"
        }]
      };
    }
  }, fixture);
}
