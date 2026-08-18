import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseBrowser67LiveDoctorPayload } from "./browser67-capability-process.js";
import { DesktopCapabilityService } from "./desktop-capability-service.js";
import {
  createDesktopCapabilityFixture,
  currentExtensionDoctorResult,
  prepareBrowserDependencies,
  writeBrowserIntegrationState,
  writeExtensionManifest
} from "./desktop-capability-service.test-fixture.js";

describe("Desktop capability service browser67 extension lifecycle", () => {
  it("prepares verified extension files and fails closed on disk drift", async () => {
    const prepared = await createDesktopCapabilityFixture();
    const runNpm = vi.fn(async (_registry: string, cwd: string) => prepareBrowserDependencies(cwd));
    const setup = vi.fn(async (_cwd: string, target: string) => writeExtensionManifest(target));
    const diskDoctor = vi.fn()
      .mockResolvedValueOnce({
        ...currentExtensionDoctorResult(),
        installedCurrent: false,
        needsSetup: true,
        targetStatus: "missing" as const
      })
      .mockResolvedValueOnce(currentExtensionDoctorResult());
    const service = new DesktopCapabilityService({
      ...prepared,
      runNpm,
      runBrowserEntrypointCheck: vi.fn(async () => undefined),
      runBrowserExtensionSetup: setup,
      runBrowserExtensionDoctor: diskDoctor,
      now: () => 500,
      createToken: () => "prepare-extension"
    });
    expect(await service.prepareBrowser67Extension()).toMatchObject({
      integrations: [{
        dependencyState: "prepared",
        extensionState: "prepared",
        doctorState: "degraded",
        extensionPreparedAt: 500,
        extensionCheckedAt: 500
      }]
    });
    expect(setup).toHaveBeenCalledWith(
      prepared.packageRoot,
      prepared.browser67ExtensionDirectory,
      prepared.toolchain
    );
    expect(diskDoctor).toHaveBeenCalledTimes(2);

    const drifted = await createDesktopCapabilityFixture();
    await prepareBrowserDependencies(drifted.packageRoot);
    const driftedService = new DesktopCapabilityService({
      ...drifted,
      runBrowserExtensionSetup: vi.fn(async (_cwd, target) => writeExtensionManifest(target)),
      runBrowserExtensionDoctor: vi.fn(async () => ({
        ...currentExtensionDoctorResult(),
        installedCurrent: false,
        needsSetup: true
      })),
      now: () => 501,
      createToken: () => "drifted-extension"
    });
    await expect(driftedService.prepareBrowser67Extension()).rejects.toThrow(
      /extension files did not match the bundled source/u
    );
    expect(await driftedService.snapshot()).toMatchObject({
      integrations: [{ extensionState: "failed", doctorState: "failed", extensionCheckedAt: 501 }]
    });
  });

  it("reloads a previously connected extension after updating its files", async () => {
    const fixture = await createDesktopCapabilityFixture();
    await prepareBrowserDependencies(fixture.packageRoot);
    await writeBrowserIntegrationState(fixture.agentDir, {
      dependencyState: "prepared",
      extensionState: "connected",
      doctorState: "ready"
    });
    const reload = vi.fn(async () => undefined);
    const diskDoctor = vi.fn()
      .mockResolvedValueOnce({
        ...currentExtensionDoctorResult(),
        installedCurrent: false,
        needsSetup: true,
        targetStatus: "missing" as const
      })
      .mockResolvedValueOnce(currentExtensionDoctorResult());
    const service = new DesktopCapabilityService({
      ...fixture,
      runBrowserExtensionSetup: vi.fn(async (_cwd, target) => writeExtensionManifest(target)),
      runBrowserExtensionDoctor: diskDoctor,
      runBrowserExtensionReload: reload,
      now: () => 510,
      createToken: () => "reload-extension"
    });
    expect(await service.prepareBrowser67Extension()).toMatchObject({
      integrations: [{
        extensionState: "reload-required",
        doctorState: "degraded",
        detail: "扩展文件已更新并请求浏览器重新加载；请验证连接。"
      }]
    });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("preserves a known live identity mismatch after preparing the managed directory", async () => {
    const fixture = await createDesktopCapabilityFixture();
    await prepareBrowserDependencies(fixture.packageRoot);
    await writeExtensionManifest(fixture.browser67ExtensionDirectory);
    await writeBrowserIntegrationState(fixture.agentDir, {
      dependencyState: "prepared",
      extensionState: "reload-required",
      doctorState: "degraded"
    });
    const service = new DesktopCapabilityService({
      ...fixture,
      runBrowserExtensionDoctor: vi.fn(async () => currentExtensionDoctorResult()),
      now: () => 510.5,
      createToken: () => "preserve-mismatch"
    });

    expect(await service.prepareBrowser67Extension()).toMatchObject({
      integrations: [{
        extensionState: "reload-required",
        doctorState: "degraded",
        detail: "受管扩展文件已是当前版本；浏览器仍需核对并同步 Pi-67 提供的加载来源。"
      }]
    });
  });

  it("does not rewrite a shared extension when only equivalent build provenance differs", async () => {
    const fixture = await createDesktopCapabilityFixture();
    await prepareBrowserDependencies(fixture.packageRoot);
    await writeExtensionManifest(fixture.browser67ExtensionDirectory);
    const setup = vi.fn(async () => undefined);
    const reload = vi.fn(async () => undefined);
    const service = new DesktopCapabilityService({
      ...fixture,
      runBrowserExtensionSetup: setup,
      runBrowserExtensionDoctor: vi.fn(async () => ({
        ...currentExtensionDoctorResult(),
        installedCurrent: false,
        identityMetadataOnlyDrift: true,
        needsSetup: true,
        needsBrowserExtensionReload: true
      })),
      runBrowserExtensionReload: reload,
      now: () => 511,
      createToken: () => "equivalent-extension"
    });
    expect(await service.prepareBrowser67Extension()).toMatchObject({
      integrations: [{
        extensionState: "prepared",
        doctorState: "degraded",
        detail: "扩展文件已是当前内置版本；请验证连接。"
      }]
    });
    expect(setup).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("rejects an extension target outside the active browser67 home", async () => {
    const fixture = await createDesktopCapabilityFixture();
    await prepareBrowserDependencies(fixture.packageRoot);
    const setup = vi.fn(async () => undefined);
    const service = new DesktopCapabilityService({
      ...fixture,
      browser67ExtensionDirectory: resolve(fixture.browser67Home, "..", "escaped-extension"),
      runBrowserExtensionSetup: setup,
      now: () => 520,
      createToken: () => "escaped-extension"
    });
    await expect(service.prepareBrowser67Extension()).rejects.toThrow(/escaped the active home/u);
    expect(setup).not.toHaveBeenCalled();
  });

  it("keeps read-only diagnosis separate from an explicitly approved Hub start", async () => {
    const fixture = await createDesktopCapabilityFixture();
    await prepareBrowserDependencies(fixture.packageRoot);
    const liveDoctor = vi.fn(async (_cwd: string, ensureHub: boolean) => ensureHub
      ? {
          ready: true,
          extensionConnected: true,
          identityMatch: true,
          detail: "extension_identity_ok"
        }
      : {
          ready: false,
          extensionConnected: false,
          identityMatch: false,
          detail: "浏览器扩展尚未连接；可从安装向导启动 Hub 并验证。"
        });
    const service = new DesktopCapabilityService({
      ...fixture,
      runBrowserExtensionDoctor: vi.fn(async () => currentExtensionDoctorResult()),
      runBrowserLiveDoctor: liveDoctor,
      now: () => 530,
      createToken: () => "verify-extension"
    });
    expect(await service.doctorBrowser67()).toMatchObject({
      integrations: [{ extensionState: "prepared", doctorState: "degraded" }]
    });
    expect(liveDoctor).toHaveBeenLastCalledWith(fixture.packageRoot, false, fixture.toolchain);
    expect(await service.verifyBrowser67Extension({ startHub: true })).toMatchObject({
      integrations: [{ extensionState: "connected", doctorState: "ready" }]
    });
    expect(liveDoctor).toHaveBeenLastCalledWith(fixture.packageRoot, true, fixture.toolchain);
  });

  it("distinguishes a live identity mismatch from an unloaded extension", async () => {
    const mismatch = await createDesktopCapabilityFixture();
    await prepareBrowserDependencies(mismatch.packageRoot);
    expect(await new DesktopCapabilityService({
      ...mismatch,
      runBrowserExtensionDoctor: vi.fn(async () => currentExtensionDoctorResult()),
      runBrowserLiveDoctor: vi.fn(async () => ({
        ready: false,
        extensionConnected: true,
        identityMatch: false,
        detail: "浏览器中运行的扩展不是当前受管版本。请在扩展管理页核对加载目录；若仍指向旧目录，请移除旧条目后从 Pi-67 提供的目录重新“加载已解压的扩展”。"
      })),
      now: () => 540,
      createToken: () => "mismatch-extension"
    }).doctorBrowser67()).toMatchObject({
      integrations: [{ extensionState: "reload-required", doctorState: "degraded" }]
    });

    const unloaded = await createDesktopCapabilityFixture();
    await prepareBrowserDependencies(unloaded.packageRoot);
    expect(await new DesktopCapabilityService({
      ...unloaded,
      runBrowserExtensionDoctor: vi.fn(async () => currentExtensionDoctorResult()),
      runBrowserLiveDoctor: vi.fn(async () => ({
        ready: false,
        extensionConnected: false,
        identityMatch: false,
        detail: "浏览器扩展尚未连接；可从安装向导启动 Hub 并验证。"
      })),
      now: () => 541,
      createToken: () => "unloaded-extension"
    }).doctorBrowser67()).toMatchObject({
      integrations: [{ extensionState: "prepared", doctorState: "degraded" }]
    });
  });

  it("does not reuse a persisted connected label without current-process live proof", async () => {
    const fixture = await createDesktopCapabilityFixture();
    await prepareBrowserDependencies(fixture.packageRoot);
    await writeBrowserIntegrationState(fixture.agentDir, {
      dependencyState: "prepared",
      extensionState: "connected",
      doctorState: "ready"
    });
    expect(await new DesktopCapabilityService(fixture).snapshot()).toMatchObject({
      integrations: [{
        extensionState: "prepared",
        doctorState: "degraded",
        detail: "扩展曾通过身份验证；请运行诊断确认本次应用进程中的真实连接。"
      }]
    });
  });

  it("accepts only strict live identity readiness and reports the relevant route", () => {
    expect(parseBrowser67LiveDoctorPayload({
      ok: true,
      doctor: {
        readiness: { reason: "tmwd_transport_ready" },
        checks: {
          tmwd_ws_runtime: {
            ok: true,
            detail: "extension_identity_ok",
            extension_connected: true,
            identity_match: true
          },
          tmwd_link_runtime: { ok: false, detail: "tcp_unreachable" }
        }
      }
    }, true)).toMatchObject({ ready: true, extensionConnected: true, identityMatch: true });

    expect(parseBrowser67LiveDoctorPayload({
      ok: false,
      doctor: {
        readiness: { reason: "tmwd_extension_identity_unverified" },
        checks: {
          tmwd_ws_runtime: { ok: false, detail: "tcp_unreachable" },
          tmwd_link_runtime: {
            ok: false,
            detail: "extension_identity_mismatch:source_digest",
            extension_connected: true,
            identity_match: false
          }
        }
      }
    }, false)).toEqual({
      ready: false,
      extensionConnected: true,
      identityMatch: false,
      detail: "浏览器中运行的扩展不是当前受管版本。请在扩展管理页核对加载目录；若仍指向旧目录，请移除旧条目后从 Pi-67 提供的目录重新“加载已解压的扩展”。"
    });
  });

  it("captures a complete live Doctor payload larger than the ordinary process-output limit", async () => {
    const fixture = await createDesktopCapabilityFixture();
    await prepareBrowserDependencies(fixture.packageRoot);
    await writeFile(join(fixture.packageRoot, "bin", "browser67.mjs"), [
      "const payload = {",
      "  ok: true,",
      "  padding: 'x'.repeat(16_000),",
      "  doctor: { checks: { tmwd_ws_runtime: {",
      "    ok: true, detail: 'extension_identity_ok', extension_connected: true, identity_match: true",
      "  } } }",
      "};",
      "process.stdout.write(`${JSON.stringify(payload)}\\n`);"
    ].join("\n"), "utf8");
    const service = new DesktopCapabilityService({
      ...fixture,
      toolchain: { ...fixture.toolchain, nodeExecutable: process.execPath },
      runBrowserExtensionDoctor: vi.fn(async () => currentExtensionDoctorResult()),
      now: () => 550,
      createToken: () => "large-live-doctor"
    });
    expect(await service.doctorBrowser67()).toMatchObject({
      integrations: [{ extensionState: "connected", doctorState: "ready" }]
    });
  });
});
