import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  browser67DependenciesPrepared,
  parseBrowser67LiveDoctorPayload,
  runBrowser67EntrypointCheck,
  runBrowser67ExtensionDoctor,
  runBrowser67ExtensionReload,
  runBrowser67ExtensionSetup,
  runBrowser67LiveDoctor,
  runBrowser67NpmInstall
} from "./browser67-capability-process.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("browser67 capability process boundary", () => {
  it("checks dependency sentinels and runs the private npm, entrypoint, and reload commands", async () => {
    const fixture = await createProcessFixture();
    expect(browser67DependenciesPrepared(fixture.root)).toBe(false);
    await mkdir(join(fixture.root, "node_modules", "ajv"), { recursive: true });
    await mkdir(join(fixture.root, "node_modules", "ws"), { recursive: true });
    await writeFile(join(fixture.root, "node_modules", "ajv", "package.json"), "{}", "utf8");
    await writeFile(join(fixture.root, "node_modules", "ws", "package.json"), "{}", "utf8");
    expect(browser67DependenciesPrepared(fixture.root)).toBe(true);

    await writeFile(fixture.toolchain.npmCli, "process.stdout.write('npm ok\\n');", "utf8");
    await writeFile(join(fixture.root, "bin", "browser67.mjs"), "process.stdout.write('Usage: browser67\\n');", "utf8");
    await writeFile(join(fixture.root, "scripts", "reload-extension-live.mjs"), "process.stdout.write('{}\\n');", "utf8");
    await expect(runBrowser67NpmInstall("https://registry.npmjs.org", fixture.root, fixture.toolchain))
      .resolves.toBeUndefined();
    await expect(runBrowser67EntrypointCheck(fixture.root, fixture.toolchain)).resolves.toBeUndefined();
    await expect(runBrowser67ExtensionReload(fixture.root, fixture.toolchain)).resolves.toBeUndefined();
  });

  it("validates setup and install-doctor JSON instead of trusting process exit alone", async () => {
    const fixture = await createProcessFixture();
    const extensionDirectory = join(fixture.root, "active-extension");
    await writeFile(join(fixture.root, "bin", "browser67.mjs"), [
      "if (process.env.BROWSER67_EXTENSION_BUILD_REVISION !== '') throw new Error('revision override leaked');",
      "if (process.env.GITHUB_SHA !== '') throw new Error('GitHub revision leaked');",
      "const target = process.argv[process.argv.indexOf('--target') + 1];",
      "process.stdout.write(`${JSON.stringify({ ok: true, product: 'browser67', extension_dir: target, mcp_registry_skipped: true })}\\n`);"
    ].join("\n"), "utf8");
    await writeFile(join(fixture.root, "scripts", "extension-install-doctor.mjs"), [
      "process.stdout.write(`${JSON.stringify({",
      "  check: 'extension-install-doctor', installed_current: true, needs_setup: false,",
      "  needs_clean_setup: false, needs_browser_extension_reload: false, target_status: 'directory'",
      "})}\\n`);"
    ].join("\n"), "utf8");
    await expect(runBrowser67ExtensionSetup(fixture.root, extensionDirectory, fixture.toolchain))
      .resolves.toBeUndefined();
    await expect(runBrowser67ExtensionDoctor(fixture.root, extensionDirectory, fixture.toolchain)).resolves.toEqual({
      installedCurrent: true,
      identityMetadataOnlyDrift: false,
      needsSetup: false,
      needsCleanSetup: false,
      needsBrowserExtensionReload: false,
      targetStatus: "directory"
    });

    await writeFile(join(fixture.root, "bin", "browser67.mjs"), "process.stdout.write('{}\\n');", "utf8");
    await expect(runBrowser67ExtensionSetup(fixture.root, extensionDirectory, fixture.toolchain))
      .rejects.toThrow("browser67 setup returned an invalid result.");
    await writeFile(
      join(fixture.root, "scripts", "extension-install-doctor.mjs"),
      "process.stdout.write('{\"check\":\"extension-install-doctor\"}\\n');",
      "utf8"
    );
    await expect(runBrowser67ExtensionDoctor(fixture.root, extensionDirectory, fixture.toolchain))
      .rejects.toThrow("browser67 extension doctor returned an invalid result.");
  });

  it("classifies equivalent installed identity metadata without hiding revision drift", async () => {
    const fixture = await createProcessFixture();
    const extensionDirectory = join(fixture.root, "active-extension");
    await mkdir(join(extensionDirectory, "browser67"), { recursive: true });
    await writeFile(join(extensionDirectory, "manifest.json"), JSON.stringify({ version: "0.4.0" }), "utf8");
    const writeIdentity = (revision: string) => writeFile(
      join(extensionDirectory, "browser67", "build-identity.json"),
      JSON.stringify({
        schema: "browser67.extension-identity.v1",
        product: "browser67",
        extension_version: "0.4.0",
        manifest_version: "0.4.0",
        build_revision: revision,
        build_revision_source: "git",
        build_inputs_dirty: false,
        source_digest: "2".repeat(64),
        protocol_revision: 1
      }),
      "utf8"
    );
    await writeIdentity("1".repeat(40));
    await writeFile(join(fixture.root, "scripts", "extension-install-doctor.mjs"), [
      "process.stdout.write(`${JSON.stringify({",
      "  check: 'extension-install-doctor', installed_current: false, needs_setup: true,",
      "  needs_clean_setup: false, needs_browser_extension_reload: true, target_status: 'directory',",
      "  missing: [], extra: [], changed: [",
      "    { file: 'browser67/build-identity.js' }, { file: 'browser67/build-identity.json' }",
      "  ]",
      "})}\n`);"
    ].join("\n"), "utf8");
    await expect(runBrowser67ExtensionDoctor(fixture.root, extensionDirectory, fixture.toolchain))
      .resolves.toMatchObject({ installedCurrent: false, identityMetadataOnlyDrift: true });

    await writeIdentity("3".repeat(40));
    await expect(runBrowser67ExtensionDoctor(fixture.root, extensionDirectory, fixture.toolchain))
      .resolves.toMatchObject({ installedCurrent: false, identityMetadataOnlyDrift: false });
  });

  it("maps live doctor readiness for unloaded, unreachable, and unexpected states", () => {
    const payload = (detail: string, extensionConnected = false) => ({
      ok: false,
      doctor: {
        checks: {
          tmwd_ws_runtime: {
            ok: false,
            detail,
            extension_connected: extensionConnected,
            identity_match: false
          }
        }
      }
    });
    expect(parseBrowser67LiveDoctorPayload(payload("extension_not_connected"), false).detail)
      .toBe("浏览器扩展尚未连接；可从安装向导启动 Hub 并验证。");
    expect(parseBrowser67LiveDoctorPayload(payload("extension_not_connected"), true).detail)
      .toContain("Hub 已启动");
    expect(parseBrowser67LiveDoctorPayload(payload("tcp_unreachable"), false).detail)
      .toContain("Hub 尚未运行");
    expect(parseBrowser67LiveDoctorPayload(payload("tcp_unreachable"), true).detail)
      .toContain("Hub 未能建立可用连接");
    expect(parseBrowser67LiveDoctorPayload(payload("unexpected_state"), false).detail)
      .toBe("browser67 尚未就绪：unexpected_state");
    expect(() => parseBrowser67LiveDoctorPayload({}, false))
      .toThrow("browser67 live doctor returned an invalid result.");
  });

  it("accepts only build provenance drift when the locked revision and runtime identity remain equal", () => {
    const identity = {
      schema: "browser67.extension-identity.v1",
      product: "browser67",
      extension_version: "0.4.0",
      manifest_version: "0.4.0",
      build_revision: "1".repeat(40),
      build_inputs_dirty: false,
      source_digest: "2".repeat(64),
      protocol_revision: 1
    };
    expect(parseBrowser67LiveDoctorPayload({
      ok: false,
      doctor: {
        checks: {
          tmwd_ws_runtime: {
            ok: false,
            detail: "extension_identity_mismatch:build_revision_source",
            extension_connected: true,
            extension_identity_status: "valid",
            expected_identity_available: true,
            identity_match: false,
            mismatches: ["build_revision_source"],
            observed_identity: { ...identity, build_revision_source: "git" },
            expected_identity: { ...identity, build_revision_source: "package_git_head" }
          }
        }
      }
    }, false)).toMatchObject({
      ready: true,
      extensionConnected: true,
      identityMatch: true,
      detail: "browser67 扩展身份与当前锁定版本一致；仅构建来源元数据不同。"
    });

    expect(parseBrowser67LiveDoctorPayload({
      ok: false,
      doctor: {
        checks: {
          tmwd_ws_runtime: {
            ok: false,
            detail: "extension_identity_mismatch:build_revision,build_revision_source",
            extension_connected: true,
            extension_identity_status: "valid",
            expected_identity_available: true,
            identity_match: false,
            mismatches: ["build_revision", "build_revision_source"],
            observed_identity: { ...identity, build_revision_source: "git" },
            expected_identity: {
              ...identity,
              build_revision: "3".repeat(40),
              build_revision_source: "package_git_head"
            }
          }
        }
      }
    }, false)).toMatchObject({ ready: false, extensionConnected: true, identityMatch: false });
  });

  it("passes the read-only Hub option to the packed doctor and accepts structured non-ready JSON", async () => {
    const fixture = await createProcessFixture();
    await writeFile(join(fixture.root, "bin", "browser67.mjs"), [
      "const readOnly = process.argv.includes('--no-ensure-tmwd-hub');",
      "const detail = readOnly ? 'tcp_unreachable' : 'extension_not_connected';",
      "process.stdout.write(`${JSON.stringify({ ok: false, doctor: { checks: { tmwd_ws_runtime: { ok: false, detail } } } })}\\n`);"
    ].join("\n"), "utf8");
    await expect(runBrowser67LiveDoctor(fixture.root, false, fixture.toolchain)).resolves.toMatchObject({
      ready: false,
      detail: "browser67 Hub 尚未运行；可从安装向导启动连接并验证。"
    });
    await expect(runBrowser67LiveDoctor(fixture.root, true, fixture.toolchain)).resolves.toMatchObject({
      ready: false,
      detail: expect.stringContaining("Hub 已启动")
    });
  });

  it("fails observably for unavailable private tools and non-zero child exits", async () => {
    const fixture = await createProcessFixture();
    const unavailable = {
      root: fixture.toolchain.root,
      ready: true,
      packaged: true,
      platform: fixture.toolchain.platform,
      architecture: fixture.toolchain.architecture
    };
    await expect(runBrowser67NpmInstall("https://registry.npmjs.org", fixture.root, unavailable))
      .rejects.toThrow("Desktop private npm is unavailable.");
    await expect(runBrowser67EntrypointCheck(fixture.root, unavailable))
      .rejects.toThrow("Desktop private Node is unavailable.");
    await writeFile(join(fixture.root, "bin", "browser67.mjs"), [
      "process.stderr.write('bounded failure\\n');",
      "process.exitCode = 7;"
    ].join("\n"), "utf8");
    await expect(runBrowser67EntrypointCheck(fixture.root, fixture.toolchain))
      .rejects.toThrow(/exited with 7: bounded failure/u);
  });
});

async function createProcessFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-browser67-process-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "bin"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    version: "0.4.0",
    gitHead: "1".repeat(40)
  }), "utf8");
  const toolchain = {
    root: join(root, "toolchain"),
    ready: true,
    packaged: true,
    platform: process.platform === "win32" ? "win32" as const : "darwin" as const,
    architecture: process.arch === "x64" ? "x64" as const : "arm64" as const,
    nodeExecutable: process.execPath,
    npmCli: join(root, "npm-cli.mjs"),
    gitExecutable: process.execPath,
    gitExecPath: join(root, "git-core")
  };
  return { root, toolchain };
}
