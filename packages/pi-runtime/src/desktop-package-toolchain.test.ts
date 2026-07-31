import { describe, expect, it, vi } from "vitest";
import { applyDesktopPackageToolchain, reloadDesktopSettings } from "./desktop-package-toolchain.js";

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
