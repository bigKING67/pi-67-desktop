import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopSessionServices } from "./session-services.js";

const roots: string[] = [];
const previousDesktop = process.env.PI67_DESKTOP;

afterEach(async () => {
  if (previousDesktop === undefined) delete process.env.PI67_DESKTOP;
  else process.env.PI67_DESKTOP = previousDesktop;
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Desktop Session package trust admission", () => {
  it("does not import a configured package until current trust observation admits it", async () => {
    process.env.PI67_DESKTOP = "1";
    const root = await mkdtemp(join(tmpdir(), "pi67-runtime-package-trust-"));
    roots.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const packageRoot = join(root, "unverified-package");
    await Promise.all([
      mkdir(cwd),
      mkdir(agentDir),
      mkdir(packageRoot)
    ]);
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "unverified-package",
      version: "1.0.0",
      pi: { extensions: ["index.ts"] }
    }));
    await writeFile(join(packageRoot, "index.ts"), `
      export default function unverifiedPackage(pi) {
        pi.registerTool({
          name: "unverified_package_tool",
          label: "Unverified package tool",
          description: "fixture",
          parameters: { type: "object", properties: {} },
          execute: async () => ({ content: [{ type: "text", text: "unexpected" }] })
        });
      }
    `);
    const settingsManager = SettingsManager.inMemory({ packages: [packageRoot] });
    const settingsReload = vi.spyOn(settingsManager, "reload");
    const refresh = vi.fn(async () => undefined);

    const blocked = await createDesktopSessionServices({
      cwd,
      agentDir,
      settingsManager,
      packageTrustRegistry: {
        refresh,
        runtimePackageAllowed: () => false
      },
      runtimeApiKeys: new Map(),
      getSafety: () => ({ cwd, trust: "trusted", approvalMode: "guided", taskToolMode: "ask" }),
      requestApproval: async () => ({ status: "denied" })
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(settingsReload).toHaveBeenCalledOnce();
    expect(blocked.resourceLoader.getExtensions().extensions.map((entry) => entry.resolvedPath))
      .not.toContain(join(packageRoot, "index.ts"));

    const admittedRefresh = vi.fn(async () => undefined);
    const packageTrustRefresh = admittedRefresh();
    const admitted = await createDesktopSessionServices({
      cwd,
      agentDir,
      settingsManager,
      packageTrustRegistry: {
        refresh: admittedRefresh,
        runtimePackageAllowed: () => true
      },
      packageTrustRefresh,
      runtimeApiKeys: new Map(),
      getSafety: () => ({ cwd, trust: "trusted", approvalMode: "guided", taskToolMode: "ask" }),
      requestApproval: async () => ({ status: "denied" })
    });
    expect(admittedRefresh).toHaveBeenCalledOnce();
    expect(settingsReload).toHaveBeenCalledTimes(2);
    expect(admitted.resourceLoader.getExtensions().extensions.map((entry) => entry.resolvedPath))
      .toContain(join(packageRoot, "index.ts"));
  });

  it("loads project resources once with the already-resolved final Workspace trust", async () => {
    process.env.PI67_DESKTOP = "1";
    const root = await mkdtemp(join(tmpdir(), "pi67-runtime-project-trust-"));
    roots.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const projectExtension = join(cwd, ".pi", "extensions", "project.ts");
    await Promise.all([
      mkdir(join(cwd, ".pi", "extensions"), { recursive: true }),
      mkdir(agentDir)
    ]);
    await writeFile(projectExtension, `
      export default function projectExtension(pi) {
        pi.registerTool({
          name: "project_trust_fixture",
          label: "Project trust fixture",
          description: "fixture",
          parameters: { type: "object", properties: {} },
          execute: async () => ({ content: [{ type: "text", text: "fixture" }] })
        });
      }
    `);

    const trustedSettings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
    const trustedReload = vi.spyOn(trustedSettings, "reload");
    const trusted = await createDesktopSessionServices({
      cwd,
      agentDir,
      settingsManager: trustedSettings,
      runtimeApiKeys: new Map(),
      getSafety: () => ({ cwd, trust: "trusted", approvalMode: "guided", taskToolMode: "ask" }),
      requestApproval: async () => ({ status: "denied" })
    });
    expect(trustedSettings.isProjectTrusted()).toBe(true);
    expect(trustedReload).toHaveBeenCalledOnce();
    expect(trusted.resourceLoader.getExtensions().extensions.map((entry) => entry.resolvedPath))
      .toContain(projectExtension);

    const untrustedSettings = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
    const untrustedReload = vi.spyOn(untrustedSettings, "reload");
    const untrusted = await createDesktopSessionServices({
      cwd,
      agentDir,
      settingsManager: untrustedSettings,
      runtimeApiKeys: new Map(),
      getSafety: () => ({ cwd, trust: "untrusted", approvalMode: "guided", taskToolMode: "ask" }),
      requestApproval: async () => ({ status: "denied" })
    });
    expect(untrustedSettings.isProjectTrusted()).toBe(false);
    expect(untrustedReload).toHaveBeenCalledOnce();
    expect(untrusted.resourceLoader.getExtensions().extensions.map((entry) => entry.resolvedPath))
      .not.toContain(projectExtension);
  });
});
