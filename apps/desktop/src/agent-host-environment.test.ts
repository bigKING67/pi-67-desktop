import { describe, expect, it } from "vitest";
import { delimiter, dirname, join } from "node:path";
import { agentHostEnvironment } from "./agent-host-environment.js";

describe("Agent Host environment", () => {
  it("overrides externally supplied storage and telemetry paths with Main-owned values", () => {
    expect(agentHostEnvironment({
      PI67_CAPABILITY_PROBE_DIR: "/untrusted",
      PI67_SESSION_CATALOG_DIR: "/also-untrusted",
      PI67_STORAGE_ROOT: "/also-untrusted-root",
      PI67_DESKTOP: "0",
      PI_TELEMETRY: "1"
    }, {
      storageRoot: "/app/user-data",
      capabilityProbeDirectory: "/app/user-data",
      sessionCatalogDirectory: "/app/user-data/projections/session-catalog"
    })).toMatchObject({
      PI67_CAPABILITY_PROBE_DIR: "/app/user-data",
      PI67_SESSION_CATALOG_DIR: "/app/user-data/projections/session-catalog",
      PI67_STORAGE_ROOT: "/app/user-data",
      PI67_DESKTOP: "1",
      PI_TELEMETRY: "0"
    });
  });

  it("rejects forged storage values that escape the Main-owned layout", () => {
    expect(() => agentHostEnvironment({}, {
      storageRoot: "/app/user-data",
      capabilityProbeDirectory: "/app/user-data",
      sessionCatalogDirectory: "/outside/session-catalog"
    })).toThrow("Main-owned userData layout");

    expect(() => agentHostEnvironment({}, {
      storageRoot: "/app/user-data",
      capabilityProbeDirectory: "/outside",
      sessionCatalogDirectory: "/app/user-data/projections/session-catalog"
    })).toThrow("Main-owned userData layout");
  });

  it("hands only the verified private toolchain and package settings path to the Host", () => {
    const toolchainRoot = join(process.platform === "win32" ? "C:\\app" : "/app", "resources", "toolchain");
    const nodeExecutable = join(toolchainRoot, "node", process.platform === "win32" ? "node.exe" : "bin/node");
    const npmCli = join(toolchainRoot, "npm", "bin", "npm-cli.js");
    const gitExecutable = join(toolchainRoot, "git", process.platform === "win32" ? "cmd/git.exe" : "bin/git");
    const gitExecPath = join(
      toolchainRoot,
      "git",
      ...(process.platform === "win32" ? ["mingw64", "libexec", "git-core"] : ["libexec", "git-core"])
    );
    const environment = agentHostEnvironment({ PATH: "/usr/bin" }, {
      storageRoot: "/app/user-data",
      capabilityProbeDirectory: "/app/user-data",
      sessionCatalogDirectory: "/app/user-data/projections/session-catalog"
    }, {
      toolchain: {
        root: toolchainRoot,
        ready: true,
        packaged: true,
        platform: "darwin",
        architecture: "arm64",
        nodeVersion: "24.18.0",
        npmVersion: "12.0.1",
        gitVersion: "2.53.0",
        nodeExecutable,
        npmCli,
        gitExecutable,
        gitExecPath
      },
      capabilitiesRoot: "/app/resources/capabilities",
      packageNetworkSettingsPath: "/app/user-data/package-manager/network-settings.json",
      packaged: true,
      electronExecutable: "/app/Pi-67 Desktop"
    });

    expect(environment).toMatchObject({
      PI67_PACKAGED: "1",
      PI67_NODE_EXECUTABLE: nodeExecutable,
      PI67_NPM_CLI: npmCli,
      PI67_GIT_EXECUTABLE: gitExecutable,
      PI67_GIT_EXEC_PATH: gitExecPath,
      PI67_CAPABILITIES_ROOT: "/app/resources/capabilities",
      PI67_PACKAGE_NETWORK_SETTINGS: "/app/user-data/package-manager/network-settings.json",
      npm_config_registry: "https://registry.npmmirror.com",
      GIT_CONFIG_VALUE_0: "https://github.com/",
      GIT_EXEC_PATH: gitExecPath
    });
    expect(environment.PATH?.split(delimiter).slice(0, 2)).toEqual([
      dirname(nodeExecutable),
      dirname(gitExecutable)
    ]);
  });
});
