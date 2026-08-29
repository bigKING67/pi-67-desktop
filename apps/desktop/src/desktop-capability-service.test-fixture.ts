import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PackageNetworkSettingsStore } from "./package-network-settings.js";

export async function createDesktopCapabilityFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-capability-service-"));
  const capabilitiesRoot = join(root, "bundled");
  const agentDir = join(root, "agent");
  const packageRoot = join(agentDir, "desktop-capabilities", "packages", "browser67");
  const browser67Home = join(root, "browser67-home");
  const browser67ExtensionDirectory = join(browser67Home, "browser", "tmwd_cdp_bridge");
  await mkdir(capabilitiesRoot, { recursive: true });
  await mkdir(join(packageRoot, "bin"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    version: "0.4.0",
    gitHead: "1".repeat(40)
  }), "utf8");
  await writeFile(join(packageRoot, "bin", "browser67.mjs"), "", "utf8");
  await writeFile(join(capabilitiesRoot, "catalog.json"), JSON.stringify({
    schema: "pi67.capability-catalog.v1",
    catalogVersion: "test.1",
    entries: [{
      id: "browser67",
      displayName: "browser67",
      origin: "first-party",
      bundled: true,
      defaultEnabled: true,
      version: "0.4.0",
      commit: "1".repeat(40),
      packagePath: "packages/browser67",
      resourceTypes: ["skill", "integration"],
      bundledExtensions: [{
        id: "browser-bridge",
        displayName: "Browser bridge",
        description: "Connects the managed browser runtime."
      }],
      bundledSkills: [{
        id: "browser67",
        displayName: "browser67",
        description: "Controls the managed browser runtime."
      }]
    }],
    bundledSkillSuites: [{
      id: "browser67",
      displayName: "browser67",
      description: "Managed browser skills.",
      versionSource: "capability-package",
      bundledVersion: "0.4.0",
      upstream: "https://github.com/example/browser67",
      sourceCommit: "1".repeat(40),
      updatePolicy: "capability-package",
      updateManager: "desktop-capability",
      independentUpdateState: "not-applicable",
      members: [{ packageId: "browser67", skillId: "browser67" }]
    }],
    recommendedExternal: [{
      id: "pi-subagents",
      source: "npm:pi-subagents",
      recommendedVersion: "0.34.0",
      installPolicy: "user-initiated",
      admissionPolicy: "known-baseline-or-user-approval",
      baselineContentSha256: "a".repeat(64)
    }]
  }), "utf8");
  await writeFile(join(agentDir, "desktop-capabilities", "state.json"), JSON.stringify({
    schema: "pi67.desktop-capability-state.v1",
    catalogVersion: "test.1",
    packages: [{ id: "browser67", installed: true }],
    rules: "installed",
    agents: "user-owned"
  }), "utf8");
  const packageNetworkSettings = new PackageNetworkSettingsStore(join(root, "user-data"));
  const toolchain = {
    root: join(root, "toolchain"),
    ready: true,
    packaged: true,
    platform: "darwin" as const,
    architecture: "arm64" as const,
    nodeVersion: "24.18.0",
    npmVersion: "12.0.1",
    gitVersion: "2.53.0",
    nodeExecutable: join(root, "toolchain", "node"),
    npmCli: join(root, "toolchain", "npm-cli.js"),
    gitExecutable: join(root, "toolchain", "git"),
    gitExecPath: join(root, "toolchain", "git-core")
  };
  return {
    capabilitiesRoot,
    capabilityProjectionMode: "legacy-copy" as const,
    agentDir,
    packageRoot,
    toolchain,
    packageNetworkSettings,
    browser67Home,
    browser67ExtensionDirectory,
    availableBrowsers: () => ["chrome" as const]
  };
}

export async function prepareBrowserDependencies(packageRoot: string) {
  await mkdir(join(packageRoot, "node_modules", "ajv"), { recursive: true });
  await mkdir(join(packageRoot, "node_modules", "ws"), { recursive: true });
  await writeFile(join(packageRoot, "node_modules", "ajv", "package.json"), "{}", "utf8");
  await writeFile(join(packageRoot, "node_modules", "ws", "package.json"), "{}", "utf8");
}

export async function writeExtensionManifest(extensionDirectory: string) {
  await mkdir(extensionDirectory, { recursive: true });
  await writeFile(join(extensionDirectory, "manifest.json"), "{}", "utf8");
}

export async function writeBrowserIntegrationState(
  agentDir: string,
  state: {
    dependencyState: "not-prepared" | "prepared" | "failed";
    extensionState: "not-prepared" | "prepared" | "reload-required" | "connected" | "failed";
    doctorState: "not-checked" | "degraded" | "ready" | "failed";
  }
) {
  const directory = join(agentDir, "desktop-capabilities", ".state", "integrations");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "browser67.json"), JSON.stringify({
    schema: "pi67.desktop-integration-state.v2",
    ...state
  }), "utf8");
}

export function currentExtensionDoctorResult() {
  return {
    installedCurrent: true,
    identityMetadataOnlyDrift: false,
    needsSetup: false,
    needsCleanSetup: false,
    needsBrowserExtensionReload: false,
    targetStatus: "directory" as const
  };
}

export async function writeManagedState(
  agentDir: string,
  options: { catalogVersion: string; installed: boolean }
) {
  await writeFile(join(agentDir, "desktop-capabilities", "state.json"), JSON.stringify({
    schema: "pi67.desktop-capability-state.v1",
    catalogVersion: options.catalogVersion,
    packages: [{ id: "browser67", installed: options.installed }],
    rules: "installed",
    agents: "user-owned"
  }), "utf8");
}
