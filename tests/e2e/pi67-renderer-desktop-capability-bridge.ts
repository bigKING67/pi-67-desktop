import type { Page } from "@playwright/test";
import type { DesktopSystemBridge, PackageNetworkSettings } from "@pi67/protocol";
import {
  createMockDesktopCapabilitySnapshot,
  createMockPackageNetworkSnapshot
} from "./pi67-renderer-system-fixtures.js";

interface MockDesktopCapabilityBridgeOptions {
  capabilityInitializingCalls?: number;
  browser67ExtensionState?: "not-prepared" | "reload-required";
}

export type MockDesktopCapabilityBridge = Pick<DesktopSystemBridge,
  | "getPlatformInfo"
  | "getPackageNetworkSnapshot"
  | "savePackageNetworkSettings"
  | "resetPackageNetworkSettings"
  | "probePackageSources"
  | "getDesktopCapabilitySnapshot"
  | "setupBrowser67"
  | "doctorBrowser67"
  | "prepareBrowser67Extension"
  | "openBrowser67ExtensionPage"
  | "revealBrowser67Extension"
  | "copyBrowser67ExtensionPath"
  | "verifyBrowser67Extension"
>;

export async function installMockDesktopCapabilityBridge(
  page: Page,
  options: MockDesktopCapabilityBridgeOptions = {}
): Promise<void> {
  const capabilitySnapshot = createMockDesktopCapabilitySnapshot();
  if (options.browser67ExtensionState === "reload-required") {
    capabilitySnapshot.integrations = capabilitySnapshot.integrations.map((integration) => integration.id === "browser67"
      ? {
          ...integration,
          dependencyState: "prepared",
          extensionState: "reload-required",
          doctorState: "degraded",
          detail: "浏览器中运行的扩展不是当前受管版本。请在扩展管理页核对加载目录；若仍指向旧目录，请移除旧条目后从 Desktop 管理目录重新“加载已解压的扩展”。"
        }
      : integration);
  }
  const fixture = {
    capabilityInitializingCalls: options.capabilityInitializingCalls ?? 0,
    capabilitySnapshot,
    packageNetworkSnapshot: createMockPackageNetworkSnapshot()
  };

  await page.addInitScript((bridgeFixture) => {
    type SystemFixtureRegistry = { methods: Partial<DesktopSystemBridge> };
    const fixtureWindow = window as unknown as {
      __pi67SystemFixture?: SystemFixtureRegistry;
    };
    const systemFixture = fixtureWindow.__pi67SystemFixture ??= { methods: {} };
    let capabilitySnapshotCalls = 0;
    const settingsActionsTest = {
      packageSaves: [] as PackageNetworkSettings[],
      packageResets: 0,
      packageProbes: [] as PackageNetworkSettings[],
      platformInfoCalls: 0
    };

    const capabilityBridge = {
      getPlatformInfo: async () => {
        settingsActionsTest.platformInfoCalls += 1;
        return {
          platform: "darwin" as const,
          architecture: "arm64" as const,
          version: "0.1.0-alpha.1"
        };
      },
      getPackageNetworkSnapshot: async () => structuredClone(bridgeFixture.packageNetworkSnapshot),
      savePackageNetworkSettings: async (settings: PackageNetworkSettings) => {
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
      probePackageSources: async (settings: PackageNetworkSettings) => {
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
          verificationState: "never",
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
          extensionState: bridgeFixture.capabilitySnapshot.integrations.some((integration) => (
            integration.id === "browser67" && integration.extensionState === "reload-required"
          )) ? "reload-required" : "prepared",
          doctorState: "degraded",
          verificationState: "never",
          availableBrowsers: ["chrome", "edge"],
          detail: bridgeFixture.capabilitySnapshot.integrations.some((integration) => (
            integration.id === "browser67" && integration.extensionState === "reload-required"
          ))
            ? "受管扩展文件已是当前版本；浏览器仍需核对并同步 Desktop 管理的加载来源。"
            : "扩展文件已准备；请在 Chrome 或 Edge 中加载后验证连接。",
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
          verificationState: "verified",
          availableBrowsers: ["chrome", "edge"],
          detail: "browser67 扩展身份与当前内置版本一致，真实受管浏览器连接已就绪。",
          preparedAt: 1_784_800_000_000,
          checkedAt: 1_784_800_000_100,
          extensionPreparedAt: 1_784_800_000_000,
          extensionCheckedAt: 1_784_800_000_100,
          verifiedAt: 1_784_800_000_100,
          registry: "https://registry.npmmirror.com"
        }]
      })
    } satisfies MockDesktopCapabilityBridge;
    Object.assign(systemFixture.methods, capabilityBridge);

    Object.defineProperty(window, "__pi67SettingsTest", {
      configurable: false,
      value: settingsActionsTest
    });
  }, fixture);
}
