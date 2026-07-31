import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DesktopCapabilityService,
  resolveDesktopAgentDirectory
} from "./desktop-capability-service.js";
import { PackageNetworkSettingsStore } from "./package-network-settings.js";

describe("Desktop capability service", () => {
  it("reports bundled capability and browser67 setup states without exposing paths", async () => {
    const fixture = await createFixture();
    const runNpm = vi.fn(async (_registry: string, cwd: string) => {
      await mkdir(join(cwd, "node_modules", "ajv"), { recursive: true });
      await mkdir(join(cwd, "node_modules", "ws"), { recursive: true });
      await writeFile(join(cwd, "node_modules", "ajv", "package.json"), "{}", "utf8");
      await writeFile(join(cwd, "node_modules", "ws", "package.json"), "{}", "utf8");
    });
    const service = new DesktopCapabilityService({
      ...fixture,
      runNpm,
      runBrowserDoctor: vi.fn(async () => undefined),
      now: () => 123,
      createToken: () => "fixture"
    });

    expect(await service.snapshot()).toMatchObject({
      phase: "ready",
      packages: [{ id: "browser67", installed: true }],
      bundledExtensions: [{ id: "browser-bridge", packageId: "browser67", installed: true }],
      bundledSkills: [{ id: "browser67", packageId: "browser67", installed: true }],
      bundledSkillSuites: [{
        id: "browser67",
        skills: [{ id: "browser67", packageId: "browser67", installed: true }]
      }],
      integrations: [{ dependencyState: "not-prepared", doctorState: "not-checked" }]
    });
    const prepared = await service.setupBrowser67();
    expect(runNpm).toHaveBeenCalledWith("https://registry.npmmirror.com", expect.any(String), fixture.toolchain);
    expect(prepared.integrations[0]).toMatchObject({
      dependencyState: "prepared",
      doctorState: "degraded",
      preparedAt: 123,
      registry: "https://registry.npmmirror.com"
    });
    expect(JSON.stringify(prepared)).not.toContain(fixture.agentDir);
  });

  it("reports missing, malformed, and stale capability metadata without false readiness", async () => {
    const missingState = await createFixture();
    await unlink(join(missingState.agentDir, "desktop-capabilities", "state.json"));
    expect(await new DesktopCapabilityService(missingState).snapshot()).toMatchObject({
      phase: "initializing",
      detail: "Agent Host 正在准备内置能力。"
    });

    const malformedState = await createFixture();
    await writeFile(join(malformedState.agentDir, "desktop-capabilities", "state.json"), "{}", "utf8");
    expect(await new DesktopCapabilityService(malformedState).snapshot()).toMatchObject({
      phase: "error",
      detail: "Managed Desktop capability state is invalid."
    });

    const staleState = await createFixture();
    await writeManagedState(staleState.agentDir, { catalogVersion: "old.1", installed: false });
    expect(await new DesktopCapabilityService(staleState).snapshot()).toMatchObject({
      phase: "degraded",
      packages: [{ installed: false }],
      detail: "内置能力版本或本地副本尚未完全就绪。"
    });

    const missingPackage = await createFixture();
    await writeManagedState(missingPackage.agentDir, { catalogVersion: "test.1", installed: false });
    expect(await new DesktopCapabilityService(missingPackage).snapshot()).toMatchObject({
      phase: "degraded",
      packages: [{ installed: false }]
    });

    const malformedCatalog = await createFixture();
    await writeFile(join(malformedCatalog.capabilitiesRoot, "catalog.json"), "{}", "utf8");
    expect(await new DesktopCapabilityService(malformedCatalog).snapshot()).toMatchObject({
      phase: "error",
      packages: [],
      detail: "Desktop capability catalog is invalid."
    });

    const malformedBrowserState = await createFixture();
    const browserStateDirectory = join(
      malformedBrowserState.agentDir,
      "desktop-capabilities",
      ".state",
      "integrations"
    );
    await mkdir(browserStateDirectory, { recursive: true });
    await writeFile(join(browserStateDirectory, "browser67.json"), "{}", "utf8");
    expect(await new DesktopCapabilityService(malformedBrowserState).snapshot()).toMatchObject({
      phase: "ready",
      integrations: [{
        dependencyState: "failed",
        doctorState: "failed",
        detail: "browser67 integration state is invalid."
      }]
    });
  });

  it("fails browser67 setup at explicit toolchain and package-network boundaries", async () => {
    const unavailableToolchain = await createFixture();
    const unavailableService = new DesktopCapabilityService({
      ...unavailableToolchain,
      toolchain: { ...unavailableToolchain.toolchain, ready: false }
    });
    await expect(unavailableService.setupBrowser67()).rejects.toThrow(/toolchain is unavailable/u);

    const offline = await createFixture();
    await offline.packageNetworkSettings.save({
      npmMode: "offline",
      gitMode: "offline",
      gitMirrors: []
    });
    await expect(new DesktopCapabilityService(offline).setupBrowser67()).rejects.toThrow(/downloads are offline/u);

    const unavailablePackage = await createFixture();
    await rm(unavailablePackage.packageRoot, { recursive: true });
    await writeFile(unavailablePackage.packageRoot, "not a directory", "utf8");
    await expect(new DesktopCapabilityService(unavailablePackage).setupBrowser67())
      .rejects.toThrow(/managed package is unavailable/u);
  });

  it("tries registries in order and persists a bounded terminal setup failure", async () => {
    const fallback = await createFixture();
    const runNpm = vi.fn(async (registry: string, cwd: string) => {
      if (registry.includes("npmmirror")) throw new Error("first registry failed");
      await prepareBrowserDependencies(cwd);
    });
    const fallbackService = new DesktopCapabilityService({
      ...fallback,
      runNpm,
      runBrowserDoctor: vi.fn(async () => undefined),
      now: () => 200,
      createToken: () => "fallback"
    });
    expect(await fallbackService.setupBrowser67()).toMatchObject({
      integrations: [{ dependencyState: "prepared", registry: "https://registry.npmjs.org" }]
    });
    expect(runNpm).toHaveBeenCalledTimes(2);

    const failure = await createFixture();
    const failureService = new DesktopCapabilityService({
      ...failure,
      runNpm: vi.fn(async () => {
        throw "registry unavailable\ninternal detail";
      }),
      runBrowserDoctor: vi.fn(async () => undefined),
      now: () => 201,
      createToken: () => "failure"
    });
    await expect(failureService.setupBrowser67()).rejects.toThrow(
      "browser67 dependencies could not be prepared: registry unavailable internal detail"
    );
    expect(await failureService.snapshot()).toMatchObject({
      integrations: [{
        dependencyState: "failed",
        doctorState: "not-checked",
        detail: "registry unavailable internal detail",
        checkedAt: 201
      }]
    });
  });

  it("distinguishes not-prepared, successful, and failed browser67 doctor checks", async () => {
    const notPrepared = await createFixture();
    expect(await new DesktopCapabilityService({
      ...notPrepared,
      now: () => 300,
      createToken: () => "not-prepared"
    }).doctorBrowser67()).toMatchObject({
      integrations: [{
        dependencyState: "not-prepared",
        doctorState: "not-checked",
        detail: "browser67 依赖尚未准备。"
      }]
    });

    const partiallyPrepared = await createFixture();
    await mkdir(join(partiallyPrepared.packageRoot, "node_modules", "ajv"), { recursive: true });
    await writeFile(
      join(partiallyPrepared.packageRoot, "node_modules", "ajv", "package.json"),
      "{}",
      "utf8"
    );
    expect(await new DesktopCapabilityService({
      ...partiallyPrepared,
      now: () => 300,
      createToken: () => "partially-prepared"
    }).doctorBrowser67()).toMatchObject({
      integrations: [{ dependencyState: "not-prepared", doctorState: "not-checked" }]
    });

    const prepared = await createFixture();
    await prepareBrowserDependencies(prepared.packageRoot);
    const doctor = vi.fn(async () => undefined);
    expect(await new DesktopCapabilityService({
      ...prepared,
      runBrowserDoctor: doctor,
      now: () => 301,
      createToken: () => "prepared"
    }).doctorBrowser67()).toMatchObject({
      integrations: [{
        dependencyState: "prepared",
        doctorState: "degraded",
        checkedAt: 301
      }]
    });
    expect(doctor).toHaveBeenCalledOnce();

    const failed = await createFixture();
    await prepareBrowserDependencies(failed.packageRoot);
    expect(await new DesktopCapabilityService({
      ...failed,
      runBrowserDoctor: vi.fn(async () => {
        throw new Error("doctor failed\nprivate detail");
      }),
      now: () => 302,
      createToken: () => "failed"
    }).doctorBrowser67()).toMatchObject({
      integrations: [{
        dependencyState: "prepared",
        doctorState: "failed",
        detail: "doctor failed private detail",
        checkedAt: 302
      }]
    });
  });

  it("fails closed when the default private npm or Node entrypoint is unavailable", async () => {
    const missingNpm = await createFixture();
    const unavailablePrivateToolchain = {
      root: missingNpm.toolchain.root,
      ready: true,
      packaged: true,
      platform: "darwin" as const,
      architecture: "arm64" as const
    };
    await expect(new DesktopCapabilityService({
      ...missingNpm,
      toolchain: unavailablePrivateToolchain,
      now: () => 400,
      createToken: () => "missing-npm"
    }).setupBrowser67()).rejects.toThrow(/Desktop private npm is unavailable/u);

    const missingNode = await createFixture();
    await prepareBrowserDependencies(missingNode.packageRoot);
    expect(await new DesktopCapabilityService({
      ...missingNode,
      toolchain: unavailablePrivateToolchain,
      now: () => 401,
      createToken: () => "missing-node"
    }).doctorBrowser67()).toMatchObject({
      integrations: [{
        dependencyState: "prepared",
        doctorState: "failed",
        detail: "Desktop private Node is unavailable."
      }]
    });

    const privateDoctor = await createFixture();
    await prepareBrowserDependencies(privateDoctor.packageRoot);
    expect(await new DesktopCapabilityService({
      ...privateDoctor,
      toolchain: { ...privateDoctor.toolchain, nodeExecutable: process.execPath },
      now: () => 402,
      createToken: () => "private-doctor"
    }).doctorBrowser67()).toMatchObject({
      integrations: [{
        dependencyState: "prepared",
        doctorState: "degraded",
        checkedAt: 402
      }]
    });
  });

  it("resolves the Desktop agent directory from every supported environment form", () => {
    expect(resolveDesktopAgentDirectory({})).toBe(join(homedir(), ".pi", "agent"));
    expect(resolveDesktopAgentDirectory({ PI_CODING_AGENT_DIR: "~" })).toBe(homedir());
    expect(resolveDesktopAgentDirectory({ PI_CODING_AGENT_DIR: "~/custom-agent" }))
      .toBe(resolve(homedir(), "custom-agent"));
    expect(resolveDesktopAgentDirectory({ PI_CODING_AGENT_DIR: "~\\custom-agent" }))
      .toBe(resolve(homedir(), "custom-agent"));
    expect(resolveDesktopAgentDirectory({ PI_CODING_AGENT_DIR: "/private/custom-agent" }))
      .toBe(resolve("/private/custom-agent"));
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-capability-service-"));
  const capabilitiesRoot = join(root, "bundled");
  const agentDir = join(root, "agent");
  const packageRoot = join(agentDir, "desktop-capabilities", "packages", "browser67");
  await mkdir(join(capabilitiesRoot), { recursive: true });
  await mkdir(join(packageRoot, "bin"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), "{}", "utf8");
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
      bundledExtensions: [{ id: "browser-bridge", displayName: "browser-bridge" }],
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
      members: [{ packageId: "browser67", skillId: "browser67" }]
    }],
    recommendedExternal: [{ id: "pi-subagents", source: "npm:pi-subagents", recommendedVersion: "0.34.0" }]
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
  return { capabilitiesRoot, agentDir, packageRoot, toolchain, packageNetworkSettings };
}

async function prepareBrowserDependencies(packageRoot: string) {
  await mkdir(join(packageRoot, "node_modules", "ajv"), { recursive: true });
  await mkdir(join(packageRoot, "node_modules", "ws"), { recursive: true });
  await writeFile(join(packageRoot, "node_modules", "ajv", "package.json"), "{}", "utf8");
  await writeFile(join(packageRoot, "node_modules", "ws", "package.json"), "{}", "utf8");
}

async function writeManagedState(
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
