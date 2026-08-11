import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DesktopCapabilityService } from "./desktop-capability-service.js";
import { resolveDesktopAgentDirectory } from "./desktop-agent-directory.js";
import {
  createDesktopCapabilityFixture as createFixture,
  currentExtensionDoctorResult,
  prepareBrowserDependencies,
  writeManagedState
} from "./desktop-capability-service.test-fixture.js";

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
      runBrowserEntrypointCheck: vi.fn(async () => undefined),
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
        versionSource: "capability-package",
        bundledVersion: "0.4.0",
        upstream: "https://github.com/example/browser67",
        sourceCommit: "1".repeat(40),
        updatePolicy: "capability-package",
        updateManager: "desktop-capability",
        independentUpdateState: "not-applicable",
        skills: [{ id: "browser67", packageId: "browser67", installed: true }]
      }],
      integrations: [{ dependencyState: "not-prepared", doctorState: "not-checked" }]
    });
    const prepared = await service.setupBrowser67();
    expect(runNpm).toHaveBeenCalledWith("https://registry.npmmirror.com", expect.any(String), fixture.toolchain);
    expect(prepared.integrations[0]).toMatchObject({
      dependencyState: "prepared",
      doctorState: "not-checked",
      preparedAt: 123,
      registry: "https://registry.npmmirror.com"
    });
    expect(JSON.stringify(prepared)).not.toContain(fixture.agentDir);
  });

  it("uses bundled browser67 dependencies without invoking npm or requiring network settings", async () => {
    const fixture = await createFixture();
    await prepareBrowserDependencies(fixture.packageRoot);
    await fixture.packageNetworkSettings.save({
      npmMode: "offline",
      gitMode: "offline",
      gitMirrors: []
    });
    const runNpm = vi.fn(async () => undefined);
    const runBrowserEntrypointCheck = vi.fn(async () => undefined);
    const service = new DesktopCapabilityService({
      ...fixture,
      runNpm,
      runBrowserEntrypointCheck,
      now: () => 124,
      createToken: () => "bundled"
    });

    await expect(service.setupBrowser67()).resolves.toMatchObject({
      integrations: [{
        dependencyState: "prepared",
        preparedAt: 124,
        detail: "内置运行依赖与命令入口已验证；浏览器扩展尚未完成连接。"
      }]
    });
    expect(runNpm).not.toHaveBeenCalled();
    expect(runBrowserEntrypointCheck).toHaveBeenCalledOnce();
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
      runBrowserEntrypointCheck: vi.fn(async () => undefined),
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
      runBrowserEntrypointCheck: vi.fn(async () => undefined),
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
        detail: "browser67 运行依赖尚未准备。"
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
    const extensionDoctor = vi.fn(async () => currentExtensionDoctorResult());
    const liveDoctor = vi.fn(async () => ({
      ready: false,
      extensionConnected: false,
      identityMatch: false,
      detail: "浏览器扩展尚未连接；可从安装向导启动 Hub 并验证。"
    }));
    expect(await new DesktopCapabilityService({
      ...prepared,
      runBrowserExtensionDoctor: extensionDoctor,
      runBrowserLiveDoctor: liveDoctor,
      now: () => 301,
      createToken: () => "prepared"
    }).doctorBrowser67()).toMatchObject({
      integrations: [{
        dependencyState: "prepared",
        doctorState: "degraded",
        checkedAt: 301
      }]
    });
    expect(extensionDoctor).toHaveBeenCalledOnce();
    expect(liveDoctor).toHaveBeenCalledOnce();

    const failed = await createFixture();
    await prepareBrowserDependencies(failed.packageRoot);
    expect(await new DesktopCapabilityService({
      ...failed,
      runBrowserExtensionDoctor: vi.fn(async () => {
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
