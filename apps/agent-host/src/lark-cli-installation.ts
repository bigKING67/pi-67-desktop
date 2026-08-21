import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveDesktopPackageToolchain } from "@pi67/pi-runtime";
import {
  activateDesktopLarkCli,
  combinedInstallationSwap,
  LarkCliInstallationError,
  type LarkCliInstallationSwap,
  type LarkSkillSynchronizationResult
} from "./lark-cli-activation.js";
import {
  beginGlobalLarkSkillInstallation,
  type LarkGlobalSkillInstallationSwap
} from "./lark-global-skill-installation.js";
import {
  desktopManagedLarkCliExecutable,
  desktopManagedLarkCliRoot,
  userGlobalLarkCliLauncher
} from "./lark-cli-resolution.js";
import {
  larkCliInstallEnvironment,
  stageDesktopLarkCliPackage,
  validateRequestedLarkCliVersions
} from "./lark-cli-package-staging.js";
import type { SkillPackProcessRunner } from "./skill-pack-process-runner.js";

export { LarkCliInstallationError } from "./lark-cli-activation.js";
export type { LarkCliInstallationSwap } from "./lark-cli-activation.js";

export async function beginDesktopLarkSkillSynchronization(options: {
  homeDirectory: string;
  skillIds: string[];
  environment: NodeJS.ProcessEnv;
  runProcess: SkillPackProcessRunner;
  platform?: NodeJS.Platform;
  strategy?: "install-missing" | "replace-managed";
}): Promise<LarkGlobalSkillInstallationSwap> {
  const toolchain = resolveDesktopPackageToolchain(options.environment);
  if (
    !toolchain.desktop
    || !toolchain.ready
    || !toolchain.nodeExecutable
    || !toolchain.npmCli
    || !toolchain.gitExecutable
    || !toolchain.gitExecPath
  ) {
    throw new LarkCliInstallationError(
      "toolchain",
      "Pi-67 Desktop 私有 Node/npm 工具链不可用，无法同步官方 Lark Skills。"
    );
  }
  try {
    return await beginGlobalLarkSkillInstallation({
      homeDirectory: options.homeDirectory,
      skillIds: options.skillIds,
      nodeExecutable: toolchain.nodeExecutable,
      npmCli: toolchain.npmCli,
      gitExecPath: toolchain.gitExecPath,
      environment: larkCliInstallEnvironment(
        options.environment,
        toolchain.nodeExecutable,
        toolchain.gitExecutable,
        toolchain.gitExecPath
      ),
      runProcess: options.runProcess,
      ...(options.platform === undefined ? {} : { platform: options.platform }),
      ...(options.strategy === undefined ? {} : { strategy: options.strategy })
    });
  } catch (error) {
    throw new LarkCliInstallationError(
      "package-install",
      "官方全局 Lark Skills 未能同步到 ~/.agents/skills，请检查安装网络后重试。",
      { cause: error }
    );
  }
}

export async function beginDesktopLarkCliInstallation(options: {
  homeDirectory: string;
  skillIds: string[];
  environment: NodeJS.ProcessEnv;
  runProcess: SkillPackProcessRunner;
  platform?: NodeJS.Platform;
  operation?: "install" | "update";
  targetVersion?: string;
  minimumVersion?: string;
  selectNpmRegistry?: () => Promise<string>;
}): Promise<LarkCliInstallationSwap> {
  const platform = options.platform ?? process.platform;
  const toolchain = resolveDesktopPackageToolchain(options.environment);
  if (
    !toolchain.desktop
    || !toolchain.ready
    || !toolchain.nodeExecutable
    || !toolchain.npmCli
    || !toolchain.gitExecutable
    || !toolchain.gitExecPath
  ) {
    throw new LarkCliInstallationError(
      "toolchain",
      "Pi-67 Desktop 私有 Node/npm 工具链不可用，无法安装 Lark CLI。"
    );
  }

  const stableRoot = desktopManagedLarkCliRoot(options.homeDirectory);
  const toolsRoot = dirname(stableRoot);
  const operationId = randomUUID();
  const stagingRoot = join(toolsRoot, `.lark-cli.staging-${operationId}`);
  const backupRoot = join(toolsRoot, `.lark-cli.backup-${operationId}`);
  validateRequestedLarkCliVersions(options.targetVersion, options.minimumVersion);
  await mkdir(toolsRoot, { recursive: true });

  try {
    const staged = await stageDesktopLarkCliPackage({
      environment: options.environment,
      homeDirectory: options.homeDirectory,
      npmCli: toolchain.npmCli,
      nodeExecutable: toolchain.nodeExecutable,
      gitExecutable: toolchain.gitExecutable,
      gitExecPath: toolchain.gitExecPath,
      runProcess: options.runProcess,
      selectNpmRegistry: options.selectNpmRegistry,
      stagingRoot,
      targetVersion: options.targetVersion,
      minimumVersion: options.minimumVersion,
      platform
    });
    const cliSwap = await activateDesktopLarkCli({
      stableRoot,
      stagingRoot,
      backupRoot,
      launcher: userGlobalLarkCliLauncher(options.homeDirectory, options.environment, platform),
      executable: desktopManagedLarkCliExecutable(options.homeDirectory, platform),
      version: staged.version,
      platform,
      operationId
    });

    let skillsSwap: LarkGlobalSkillInstallationSwap;
    try {
      skillsSwap = await beginGlobalLarkSkillInstallation({
        homeDirectory: options.homeDirectory,
        skillIds: options.skillIds,
        nodeExecutable: toolchain.nodeExecutable,
        npmCli: toolchain.npmCli,
        gitExecPath: toolchain.gitExecPath,
        environment: staged.environment,
        runProcess: options.runProcess,
        platform,
        strategy: options.operation === "update" ? "replace-managed" : "install-missing"
      });
    } catch {
      return cliSwapWithPendingSkills(cliSwap);
    }
    return combinedInstallationSwap(cliSwap, skillsSwap);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function cliSwapWithPendingSkills(
  cli: LarkCliInstallationSwap
): LarkCliInstallationSwap {
  const skills: LarkSkillSynchronizationResult = {
    state: "pending",
    installedSkillCount: 0,
    detail: "Lark CLI 已更新并验证；官方全局 Skills 同步未完成，可直接重试 Skills 同步，无需重新下载 CLI。"
  };
  return {
    executable: cli.executable,
    version: cli.version,
    skills,
    commit: () => cli.commit(),
    rollback: () => cli.rollback()
  };
}
