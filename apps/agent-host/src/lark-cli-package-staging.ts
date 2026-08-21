import { constants } from "node:fs";
import { access, lstat, readFile, rm } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { LarkCliInstallationError } from "./lark-cli-activation.js";
import { larkCliProcessEnvironment } from "./lark-cli-resolution.js";
import { compareLarkCliVersions, isLarkCliVersion } from "./lark-cli-version.js";
import {
  loadPackageNetworkSettings,
  NpmRegistryUnavailableError,
  runWithNpmRegistryFallback
} from "./package-network-settings.js";
import type { SkillPackProcessRunner } from "./skill-pack-process-runner.js";
import { parseLarkUpdateResult } from "./skill-pack-update-state.js";

const LARK_CLI_PACKAGE_NAME = "@larksuite/cli";
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const VERIFY_TIMEOUT_MS = 60_000;
const MAX_PACKAGE_MANIFEST_BYTES = 64 * 1024;
const MAX_INSTALL_SCRIPT_BYTES = 512 * 1024;
const INSTALL_ENVIRONMENT_KEYS = [
  "APPDATA",
  "ComSpec",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LOCALAPPDATA",
  "LOGNAME",
  "NPM_CONFIG_REGISTRY",
  "PATH",
  "PATHEXT",
  "PI67_ELECTRON_EXECUTABLE",
  "PI67_WINDOWS_JOB_CONTROLLER",
  "SHELL",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
  "USERPROFILE",
  "WINDIR",
  "npm_config_registry"
] as const;

export interface DesktopLarkCliPackageStagingOptions {
  environment: NodeJS.ProcessEnv;
  homeDirectory: string;
  npmCli: string;
  nodeExecutable: string;
  gitExecutable: string;
  gitExecPath: string;
  runProcess: SkillPackProcessRunner;
  selectNpmRegistry: (() => Promise<string>) | undefined;
  stagingRoot: string;
  targetVersion: string | undefined;
  minimumVersion: string | undefined;
  platform: NodeJS.Platform;
}

export function validateRequestedLarkCliVersions(
  targetVersion: string | undefined,
  minimumVersion: string | undefined
): void {
  if (
    (targetVersion !== undefined && !isLarkCliVersion(targetVersion))
    || (minimumVersion !== undefined && !isLarkCliVersion(minimumVersion))
  ) {
    throw new LarkCliInstallationError(
      "validation",
      "Lark CLI 更新通道返回了无效版本，未下载或替换现有安装。"
    );
  }
  if (
    targetVersion !== undefined
    && minimumVersion !== undefined
    && compareLarkCliVersions(targetVersion, minimumVersion) < 0
  ) {
    throw new LarkCliInstallationError(
      "validation",
      `Lark CLI 目标版本 ${targetVersion} 低于当前版本 ${minimumVersion}，已拒绝降级。`
    );
  }
}

export async function stageDesktopLarkCliPackage(
  options: DesktopLarkCliPackageStagingOptions
): Promise<{ environment: NodeJS.ProcessEnv; version: string }> {
  const environment = await downloadStagedLarkCliPackage({
    ...options,
    targetVersion: options.targetVersion ?? "latest"
  });
  const stagedPackage = await validateStagedLarkCliPackage(options.stagingRoot);
  validateStagedVersion(stagedPackage.version, options.targetVersion, options.minimumVersion);
  try {
    await options.runProcess(options.nodeExecutable, [stagedPackage.installScript], {
      cwd: stagedPackage.packageRoot,
      timeoutMs: INSTALL_TIMEOUT_MS,
      environment
    });
  } catch (error) {
    throw new LarkCliInstallationError(
      "package-install",
      "官方 Lark CLI 包已下载，但原生程序安装未完成，请检查下载网络和系统解压工具后重试。",
      { cause: error }
    );
  }
  const staged = await validateInstalledLarkCli({
    ...options,
    environment,
    version: stagedPackage.version
  });
  return { environment, version: staged.version };
}

export function larkCliInstallEnvironment(
  source: NodeJS.ProcessEnv,
  nodeExecutable: string,
  gitExecutable: string,
  gitExecPath: string
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  // Package execution paths are infrastructure rather than user credentials,
  // so retain them while copying the environment without unrelated secrets.
  for (const key of INSTALL_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (typeof value === "string") environment[key] = value;
  }
  const entries = [dirname(nodeExecutable), dirname(gitExecutable), ...(environment.PATH ?? "").split(delimiter)]
    .filter(Boolean);
  environment.PATH = entries.filter((entry, index) => entries.indexOf(entry) === index).join(delimiter);
  environment.NO_COLOR = "1";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GCM_INTERACTIVE = "never";
  environment.GIT_EXEC_PATH = gitExecPath;
  environment.npm_config_audit = "false";
  environment.npm_config_fund = "false";
  environment.npm_config_update_notifier = "false";
  return environment;
}

async function downloadStagedLarkCliPackage(
  options: DesktopLarkCliPackageStagingOptions & { targetVersion: string }
): Promise<NodeJS.ProcessEnv> {
  let settings: Awaited<ReturnType<typeof loadPackageNetworkSettings>> | undefined;
  try {
    if (!options.selectNpmRegistry) {
      settings = await loadPackageNetworkSettings(options.environment.PI67_PACKAGE_NETWORK_SETTINGS);
    }
  } catch (error) {
    throw new LarkCliInstallationError(
      "package-install",
      "下载源配置无效，无法更新 Lark CLI。请在“下载源与网络”中保存有效设置后重试。",
      { cause: error }
    );
  }

  const attempt = async (registry: string): Promise<NodeJS.ProcessEnv> => {
    const environment = larkCliInstallEnvironment(
      options.environment,
      options.nodeExecutable,
      options.gitExecutable,
      options.gitExecPath
    );
    environment.NPM_CONFIG_REGISTRY = registry;
    environment.npm_config_registry = registry;
    await rm(options.stagingRoot, { recursive: true, force: true });
    try {
      await options.runProcess(options.nodeExecutable, [
        options.npmCli,
        "install",
        "--registry",
        registry,
        "--prefix",
        options.stagingRoot,
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        "--omit=dev",
        "--ignore-scripts",
        `${LARK_CLI_PACKAGE_NAME}@${options.targetVersion}`
      ], {
        cwd: options.homeDirectory,
        timeoutMs: INSTALL_TIMEOUT_MS,
        environment
      });
      return environment;
    } catch (error) {
      await rm(options.stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  };

  try {
    if (options.selectNpmRegistry) return await attempt(await options.selectNpmRegistry());
    return (await runWithNpmRegistryFallback(settings!, attempt, {
      resourcePath: larkCliRegistryResourcePath(options.targetVersion)
    })).value;
  } catch (error) {
    if (error instanceof NpmRegistryUnavailableError) {
      throw new LarkCliInstallationError(
        "package-install",
        error.candidateCount === 0
          ? "当前下载源设置为离线模式，无法更新 Lark CLI。请在“下载源与网络”中启用 npm 下载源后重试。"
          : error.reachableCandidateCount === 0
            ? "无法连接已配置的 npm 下载源。请在“下载源与网络”中检查或切换 npm 源后重试。"
            : "已配置的 npm 下载源均未能完成 Lark CLI 下载；已自动尝试后续来源。请检查安装网络设置后重试。",
        { cause: error }
      );
    }
    throw new LarkCliInstallationError(
      "package-install",
      "无法下载并安装官方 Lark CLI，请检查安装网络设置后重试。",
      { cause: error }
    );
  }
}

function larkCliRegistryResourcePath(version: string): string {
  return `/@larksuite%2Fcli/${encodeURIComponent(version)}`;
}

function validateStagedVersion(
  stagedVersion: string,
  targetVersion: string | undefined,
  minimumVersion: string | undefined
): void {
  if (targetVersion !== undefined && stagedVersion !== targetVersion) {
    throw new LarkCliInstallationError(
      "validation",
      `下载的 Lark CLI 版本 ${stagedVersion} 与已确认目标 ${targetVersion} 不一致，未执行或替换现有安装。`
    );
  }
  if (minimumVersion !== undefined && compareLarkCliVersions(stagedVersion, minimumVersion) < 0) {
    throw new LarkCliInstallationError(
      "validation",
      `下载的 Lark CLI 版本 ${stagedVersion} 低于当前版本 ${minimumVersion}，已拒绝降级。`
    );
  }
}

async function validateStagedLarkCliPackage(stagingRoot: string): Promise<{
  packageRoot: string;
  installScript: string;
  version: string;
}> {
  try {
    const packageRoot = join(stagingRoot, "node_modules", "@larksuite", "cli");
    const manifestPath = join(packageRoot, "package.json");
    const manifestMetadata = await lstat(manifestPath);
    if (
      manifestMetadata.isSymbolicLink()
      || !manifestMetadata.isFile()
      || manifestMetadata.size > MAX_PACKAGE_MANIFEST_BYTES
    ) throw new Error("invalid package manifest");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    if (!isLarkCliManifest(manifest)) throw new Error("unexpected package identity");

    const installScript = join(packageRoot, "scripts", "install.js");
    const installScriptMetadata = await lstat(installScript);
    if (
      installScriptMetadata.isSymbolicLink()
      || !installScriptMetadata.isFile()
      || installScriptMetadata.size === 0
      || installScriptMetadata.size > MAX_INSTALL_SCRIPT_BYTES
    ) throw new Error("invalid package install script");
    return { packageRoot, installScript, version: manifest.version };
  } catch (error) {
    throw new LarkCliInstallationError(
      "validation",
      "下载的 Lark CLI 未通过包身份或安装入口验证，未执行安装脚本，也未替换现有安装。",
      { cause: error }
    );
  }
}

async function validateInstalledLarkCli(options: {
  stagingRoot: string;
  homeDirectory: string;
  environment: NodeJS.ProcessEnv;
  runProcess: SkillPackProcessRunner;
  platform: NodeJS.Platform;
  version: string;
}): Promise<{ version: string }> {
  try {
    const packageRoot = join(options.stagingRoot, "node_modules", "@larksuite", "cli");
    const executable = join(
      packageRoot,
      "bin",
      options.platform === "win32" ? "lark-cli.exe" : "lark-cli"
    );
    const executableMetadata = await lstat(executable);
    if (executableMetadata.isSymbolicLink() || !executableMetadata.isFile() || executableMetadata.size === 0) {
      throw new Error("invalid native executable");
    }
    if (options.platform !== "win32") await access(executable, constants.X_OK);

    const processEnvironment = larkCliProcessEnvironment(options.environment, executable);
    const versionResult = await options.runProcess(executable, ["--version"], {
      cwd: options.homeDirectory,
      timeoutMs: 15_000,
      environment: processEnvironment
    });
    if (!new RegExp(`(?:^|\\s)${escapeRegExp(options.version)}(?:\\s|$)`, "u")
      .test(`${versionResult.stdout}\n${versionResult.stderr}`)) {
      throw new Error("native version does not match package version");
    }
    const updateResult = await options.runProcess(executable, ["update", "--check", "--json"], {
      cwd: options.homeDirectory,
      timeoutMs: VERIFY_TIMEOUT_MS,
      environment: processEnvironment
    });
    parseLarkUpdateResult(updateResult.stdout);
    return { version: options.version };
  } catch (error) {
    throw new LarkCliInstallationError(
      "validation",
      "下载的 Lark CLI 未通过包身份、原生程序或更新通道验证，未替换现有安装。",
      { cause: error }
    );
  }
}

function isLarkCliManifest(value: unknown): value is { name: string; version: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.name === LARK_CLI_PACKAGE_NAME
    && typeof record.version === "string"
    && isLarkCliVersion(record.version);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
