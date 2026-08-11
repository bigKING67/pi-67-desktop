import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSessionServices,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyDesktopPackageToolchain,
  createDesktopPackageSettingsView,
  installDesktopPackageToolchainReloadHook,
  reloadDesktopSettings
} from "./desktop-package-toolchain.js";

const environment = {
  PI67_DESKTOP: "1",
  PI67_PACKAGED: "1",
  PI67_TOOLCHAIN_ROOT: "/app/toolchain",
  PI67_NODE_EXECUTABLE: "/app/toolchain/node/bin/node",
  PI67_NPM_CLI: "/app/toolchain/npm/bin/npm-cli.js",
  PI67_GIT_EXECUTABLE: "/app/toolchain/git/bin/git",
  PI67_GIT_EXEC_PATH: "/app/toolchain/git/libexec/git-core",
  PI67_MANAGED_CAPABILITIES_ROOT: "/app/agent/desktop-capabilities",
  PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([
    "/app/agent/desktop-capabilities/packages/pi67-core",
    "/app/agent/desktop-capabilities/packages/design-craft"
  ])
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("Pi SettingsManager Desktop package toolchain override", () => {
  it("applies private Node + npm without persisting a user npmCommand", () => {
    const applyOverrides = vi.fn();
    expect(applyDesktopPackageToolchain({ applyOverrides, getPackages: () => ["npm:external"] }, environment))
      .toMatchObject({ ready: true });
    expect(applyOverrides).toHaveBeenCalledWith({
      npmCommand: [
        "/app/toolchain/node/bin/node",
        "/app/toolchain/npm/bin/npm-cli.js"
      ],
      packages: [
        "npm:external",
        "/app/agent/desktop-capabilities/packages/pi67-core",
        "/app/agent/desktop-capabilities/packages/design-craft"
      ]
    });
  });

  it("reapplies the runtime-only override after SettingsManager reload", async () => {
    const reload = vi.fn(async () => undefined);
    const applyOverrides = vi.fn();
    await reloadDesktopSettings({ reload, applyOverrides, getPackages: () => [] }, environment);
    expect(reload).toHaveBeenCalledOnce();
    expect(applyOverrides).toHaveBeenCalledOnce();
  });

  it("keeps runtime-only overrides across nested Pi reloads and restores the original method", async () => {
    const originalReload = vi.fn(async () => undefined);
    const settingsManager = {
      reload: originalReload,
      applyOverrides: vi.fn(),
      getPackages: () => []
    };
    const releaseFirst = installDesktopPackageToolchainReloadHook(settingsManager, environment);
    const wrappedReload = settingsManager.reload;
    const releaseSecond = installDesktopPackageToolchainReloadHook(settingsManager, environment);

    await settingsManager.reload();

    expect(originalReload).toHaveBeenCalledOnce();
    expect(settingsManager.applyOverrides).toHaveBeenCalledTimes(3);
    releaseSecond();
    expect(settingsManager.reload).toBe(wrappedReload);
    releaseFirst();
    expect(settingsManager.reload).toBe(originalReload);
  });

  it("exposes managed Packages only through the Pi session view and never persists them", () => {
    const settingsManager = SettingsManager.inMemory({
      packages: ["npm:user-package"],
      extensions: ["extensions/user-tool/index.ts", "-extensions/xtalpi-pi-tools/index.ts"]
    });
    const setPackages = vi.spyOn(settingsManager, "setPackages");
    const sessionView = createDesktopPackageSettingsView(settingsManager, environment);

    expect(sessionView.getGlobalSettings().packages).toEqual([
      "npm:user-package",
      "/app/agent/desktop-capabilities/packages/pi67-core",
      "/app/agent/desktop-capabilities/packages/design-craft"
    ]);
    expect(sessionView.getGlobalSettings().extensions).toEqual([
      "extensions/user-tool/index.ts",
      "-extensions/xtalpi-pi-tools/index.ts",
      "-extensions/pi-rules-loader/index.ts",
      "-extensions/pi-vision-bridge/index.ts"
    ]);
    expect(settingsManager.getGlobalSettings().packages).toEqual(["npm:user-package"]);
    expect(settingsManager.getGlobalSettings().extensions).toEqual([
      "extensions/user-tool/index.ts",
      "-extensions/xtalpi-pi-tools/index.ts"
    ]);

    sessionView.setPackages([
      "npm:user-package",
      "/app/agent/desktop-capabilities/packages/pi67-core",
      "/app/agent/desktop-capabilities/skill-packs/stale-overlay/package",
      { source: "/external/user-package", autoload: false }
    ]);

    expect(setPackages).toHaveBeenCalledWith([
      "npm:user-package",
      { source: "/external/user-package", autoload: false }
    ]);
    expect(settingsManager.getGlobalSettings().packages).toEqual([
      "npm:user-package",
      { source: "/external/user-package", autoload: false }
    ]);
  });

  it("admits only currently observed or verified packages to the Pi Runtime view", () => {
    const settingsManager = SettingsManager.inMemory({
      packages: ["npm:observed", "npm:unverified"]
    });
    settingsManager.setProjectPackages([
      "npm:project-observed",
      "npm:project-drifted"
    ]);
    const sessionView = createDesktopPackageSettingsView(settingsManager, environment, {
      runtimePackageAllowed: (source, scope) => (
        source.includes("desktop-capabilities")
        || (scope === "global" && source === "npm:observed")
        || (scope === "project" && source === "npm:project-observed")
      )
    });

    expect(sessionView.getGlobalSettings().packages).toEqual([
      "npm:observed",
      "/app/agent/desktop-capabilities/packages/pi67-core",
      "/app/agent/desktop-capabilities/packages/design-craft"
    ]);
    expect(sessionView.getProjectSettings().packages).toEqual(["npm:project-observed"]);
    expect(sessionView.getPackages()).not.toContain("npm:unverified");
    expect(sessionView.getPackages()).not.toContain("npm:project-drifted");
  });

  it("excludes native-replaced Plan, web, and subagent Packages only from the Desktop runtime projection", () => {
    const configured = [
      "npm:@narumitw/pi-plan-mode@0.11.0",
      "npm:pi-web-access",
      { source: "npm:pi-smart-fetch@0.3.12", autoload: false },
      "npm:pi-subagents"
    ];
    const settingsManager = SettingsManager.inMemory({ packages: structuredClone(configured) });
    const sessionView = createDesktopPackageSettingsView(settingsManager, environment);

    expect(sessionView.getGlobalSettings().packages).toEqual([
      "/app/agent/desktop-capabilities/packages/pi67-core",
      "/app/agent/desktop-capabilities/packages/design-craft"
    ]);
    expect(settingsManager.getGlobalSettings().packages).toEqual(configured);
  });

  it("uses verified managed adapter and memory Packages without rewriting user npm sources", () => {
    const managedRoot = "/app/agent/desktop-capabilities/managed-packages/active";
    const adapter = `${managedRoot}/packages/pi-mcp-adapter`;
    const memory = `${managedRoot}/packages/pi-observational-memory`;
    const configured = [
      "npm:pi-mcp-adapter@2.11.0",
      "npm:pi-observational-memory@3.0.3",
      "npm:user-package"
    ];
    const settingsManager = SettingsManager.inMemory({ packages: structuredClone(configured) });
    const sessionView = createDesktopPackageSettingsView(settingsManager, {
      ...environment,
      PI67_MANAGED_NPM_ROOT: managedRoot,
      PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([
        "/app/agent/desktop-capabilities/packages/pi67-core",
        adapter,
        memory
      ])
    });

    expect(sessionView.getGlobalSettings().packages).toEqual([
      "npm:user-package",
      "/app/agent/desktop-capabilities/packages/pi67-core",
      adapter,
      memory
    ]);
    expect(settingsManager.getGlobalSettings().packages).toEqual(configured);
  });

  it("keeps legacy first-party extensions when the managed Pi-67 Core Package is absent", () => {
    const settingsManager = SettingsManager.inMemory({ extensions: ["extensions/pi-hy-memory/index.ts"] });
    const sessionView = createDesktopPackageSettingsView(settingsManager, {
      ...environment,
      PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([
        "/app/agent/desktop-capabilities/packages/design-craft"
      ])
    });

    expect(sessionView.getGlobalSettings().extensions).toEqual([
      "extensions/pi-hy-memory/index.ts"
    ]);
  });

  it("loads the managed Pi-67 Core extension once instead of the identical legacy copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-managed-extension-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const managedRoot = join(agentDir, "desktop-capabilities");
    const managedPackage = join(managedRoot, "packages", "pi67-core");
    const legacyExtension = join(agentDir, "extensions", "pi-rules-loader");
    const managedExtension = join(managedPackage, "extensions", "pi-rules-loader");
    await Promise.all([
      mkdir(cwd, { recursive: true }),
      mkdir(legacyExtension, { recursive: true }),
      mkdir(managedExtension, { recursive: true })
    ]);
    const extensionSource = `export default function extension(pi) {
      pi.registerTool({
        name: "rules_fixture",
        label: "Rules fixture",
        description: "fixture",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: [{ type: "text", text: "ok" }] })
      });
    }`;
    await Promise.all([
      writeFile(join(legacyExtension, "index.ts"), extensionSource),
      writeFile(join(managedExtension, "index.ts"), extensionSource),
      writeFile(join(managedPackage, "package.json"), JSON.stringify({
        name: "pi67-core",
        version: "0.15.8",
        pi: { extensions: ["./extensions/pi-rules-loader/index.ts"] }
      }))
    ]);
    const settingsManager = createDesktopPackageSettingsView(SettingsManager.inMemory(), {
      PI67_DESKTOP: "1",
      PI67_MANAGED_CAPABILITIES_ROOT: managedRoot,
      PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([managedPackage])
    });
    const services = await createAgentSessionServices({ cwd, agentDir, settingsManager });

    expect(services.resourceLoader.getExtensions().extensions.map((extension) => extension.resolvedPath))
      .toEqual([join(managedExtension, "index.ts")]);
    expect(services.resourceLoader.getExtensions().errors).toEqual([]);
  });

  it("fails closed for a Desktop Host without the bundled toolchain", () => {
    expect(() => applyDesktopPackageToolchain({ applyOverrides: vi.fn(), getPackages: () => [] }, {
      PI67_DESKTOP: "1",
      PI67_PACKAGED: "1"
    })).toThrow(/private Node\/npm\/Git toolchain/u);
    expect(() => applyDesktopPackageToolchain({ applyOverrides: vi.fn(), getPackages: () => [] }, {})).not.toThrow();
  });

  it("rejects managed package paths outside the verified capability root", () => {
    expect(() => applyDesktopPackageToolchain({
      applyOverrides: vi.fn(),
      getPackages: () => []
    }, {
      ...environment,
      PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify(["/outside/package"])
    })).toThrow("escaped their verified root");
  });
});
