import { delimiter, dirname, join, resolve } from "node:path";
import type { DesktopToolchain } from "./desktop-toolchain.js";

export interface AgentHostStoragePaths {
  readonly storageRoot: string;
  readonly capabilityProbeDirectory: string;
  readonly sessionCatalogDirectory: string;
}

export interface AgentHostRuntimeEnvironment {
  readonly toolchain: DesktopToolchain;
  readonly capabilitiesRoot: string;
  readonly packageNetworkSettingsPath: string;
  readonly packaged: boolean;
  readonly electronExecutable: string;
}

export function agentHostEnvironment(
  source: NodeJS.ProcessEnv,
  storage: AgentHostStoragePaths,
  runtime?: AgentHostRuntimeEnvironment
): NodeJS.ProcessEnv {
  assertMainOwnedStorageLayout(storage);
  const environment: NodeJS.ProcessEnv = {
    ...source,
    PI67_DESKTOP: "1",
    PI_TELEMETRY: "0",
    PI67_STORAGE_ROOT: storage.storageRoot,
    PI67_CAPABILITY_PROBE_DIR: storage.capabilityProbeDirectory,
    PI67_SESSION_CATALOG_DIR: storage.sessionCatalogDirectory
  };
  if (!runtime) return environment;
  environment.PI67_PACKAGED = runtime.packaged ? "1" : "0";
  environment.PI67_ELECTRON_EXECUTABLE = runtime.electronExecutable;
  environment.PI67_CAPABILITIES_ROOT = runtime.capabilitiesRoot;
  environment.PI67_PACKAGE_NETWORK_SETTINGS = runtime.packageNetworkSettingsPath;
  environment.PI67_TOOLCHAIN_ROOT = runtime.toolchain.root;
  if (!runtime.toolchain.ready) return environment;
  const nodeExecutable = requireToolPath(runtime.toolchain.nodeExecutable, "Node");
  const npmCli = requireToolPath(runtime.toolchain.npmCli, "npm CLI");
  const gitExecutable = requireToolPath(runtime.toolchain.gitExecutable, "Git");
  const gitExecPath = requireToolPath(runtime.toolchain.gitExecPath, "Git exec-path");
  environment.PI67_NODE_EXECUTABLE = nodeExecutable;
  environment.PI67_NPM_CLI = npmCli;
  environment.PI67_GIT_EXECUTABLE = gitExecutable;
  environment.PI67_GIT_EXEC_PATH = gitExecPath;
  environment.PATH = [dirname(nodeExecutable), dirname(gitExecutable), source.PATH]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(delimiter);
  // ResourceLoader may install missing configured packages before the GUI worker runs.
  environment.npm_config_registry = "https://registry.npmmirror.com";
  environment.NPM_CONFIG_REGISTRY = "https://registry.npmmirror.com";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GCM_INTERACTIVE = "never";
  environment.GIT_EXEC_PATH = gitExecPath;
  environment.GIT_CONFIG_COUNT = "1";
  environment.GIT_CONFIG_KEY_0 = "url.https://gitclone.com/github.com/.insteadOf";
  environment.GIT_CONFIG_VALUE_0 = "https://github.com/";
  return environment;
}

function requireToolPath(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Desktop private ${label} path is missing.`);
  return value;
}

function assertMainOwnedStorageLayout(storage: AgentHostStoragePaths): void {
  const root = resolve(storage.storageRoot);
  if (
    !samePath(storage.capabilityProbeDirectory, root)
    || !samePath(storage.sessionCatalogDirectory, join(root, "projections", "session-catalog"))
  ) {
    throw new Error("Pi runtime service storage must use the Main-owned userData layout.");
  }
}

function samePath(left: string, right: string): boolean {
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLowerCase()
    : (value: string) => resolve(value);
  return normalize(left) === normalize(right);
}
