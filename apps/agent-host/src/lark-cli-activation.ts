import { chmod, copyFile, lstat, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LarkGlobalSkillInstallationSwap } from "./lark-global-skill-installation.js";

export type LarkCliInstallationStage =
  | "toolchain"
  | "package-install"
  | "validation"
  | "activation"
  | "recovery";

export class LarkCliInstallationError extends Error {
  constructor(
    readonly stage: LarkCliInstallationStage,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "LarkCliInstallationError";
  }
}

export interface LarkCliInstallationSwap {
  readonly executable: string;
  readonly version: string;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export async function activateDesktopLarkCli(options: {
  stableRoot: string;
  stagingRoot: string;
  backupRoot: string;
  launcher: string;
  executable: string;
  version: string;
  platform: NodeJS.Platform;
  operationId: string;
}): Promise<LarkCliInstallationSwap> {
  const hadPrevious = await pathExists(options.stableRoot);
  const hadLauncher = await pathExists(options.launcher);
  if (hadLauncher && !hadPrevious) {
    throw new LarkCliInstallationError(
      "activation",
      "用户级 lark-cli 启动器已存在，但不属于当前 Desktop 管理安装；为避免覆盖，请先修复或移除该冲突。"
    );
  }
  const launcherBackup = join(dirname(options.stableRoot), `.lark-cli-launcher.backup-${options.operationId}`);
  const temporaryLauncher = join(dirname(options.launcher), `.lark-cli.pi67-${options.operationId}`);
  let stableActivated = false;
  let launcherBackedUp = false;
  let launcherActivated = false;
  try {
    await mkdir(dirname(options.launcher), { recursive: true });
    if (hadPrevious) await rename(options.stableRoot, options.backupRoot);
    if (hadLauncher) {
      await rename(options.launcher, launcherBackup);
      launcherBackedUp = true;
    }
    await rename(options.stagingRoot, options.stableRoot);
    stableActivated = true;
    await copyFile(options.executable, temporaryLauncher);
    if (options.platform !== "win32") await chmod(temporaryLauncher, 0o755);
    await rename(temporaryLauncher, options.launcher);
    launcherActivated = true;
  } catch (error) {
    const recoveryErrors = await restoreCliActivation({
      ...options,
      hadPrevious,
      launcherActivated,
      launcherBackedUp,
      launcherBackup,
      stableActivated,
      temporaryLauncher
    });
    if (recoveryErrors.length > 0) {
      throw new LarkCliInstallationError(
        "recovery",
        "Lark CLI 激活失败，且无法恢复之前的用户级共享安装。",
        { cause: new AggregateError([error, ...recoveryErrors]) }
      );
    }
    throw new LarkCliInstallationError(
      "activation",
      "Lark CLI 已下载并验证，但无法激活到用户级共享目录。",
      { cause: error }
    );
  }

  let finalized = false;
  return {
    executable: options.executable,
    version: options.version,
    async commit() {
      if (finalized) return;
      finalized = true;
      if (hadPrevious) {
        await rm(options.backupRoot, { recursive: true, force: true }).catch(() => undefined);
      }
      if (launcherBackedUp) await rm(launcherBackup, { force: true }).catch(() => undefined);
    },
    async rollback() {
      if (finalized) return;
      const recoveryErrors = await restoreCliActivation({
        ...options,
        hadPrevious,
        launcherActivated: true,
        launcherBackedUp,
        launcherBackup,
        stableActivated: true,
        temporaryLauncher
      });
      if (recoveryErrors.length > 0) {
        throw new AggregateError(recoveryErrors, "The previous user-global Lark CLI could not be restored.");
      }
      finalized = true;
    }
  };
}

export function combinedInstallationSwap(
  cli: LarkCliInstallationSwap,
  skills: LarkGlobalSkillInstallationSwap
): LarkCliInstallationSwap {
  let finalized = false;
  return {
    executable: cli.executable,
    version: cli.version,
    async commit() {
      if (finalized) return;
      await cli.commit();
      await skills.commit();
      finalized = true;
    },
    async rollback() {
      if (finalized) return;
      const errors: unknown[] = [];
      await cli.rollback().catch((error) => errors.push(error));
      await skills.rollback().catch((error) => errors.push(error));
      if (errors.length > 0) {
        throw new AggregateError(errors, "Lark CLI 与全局 Skills 无法完整恢复。");
      }
      finalized = true;
    }
  };
}

async function restoreCliActivation(options: {
  stableRoot: string;
  backupRoot: string;
  launcher: string;
  hadPrevious: boolean;
  launcherActivated: boolean;
  launcherBackedUp: boolean;
  launcherBackup: string;
  stableActivated: boolean;
  temporaryLauncher: string;
}): Promise<unknown[]> {
  const errors: unknown[] = [];
  await rm(options.temporaryLauncher, { force: true }).catch((error) => errors.push(error));
  if (options.launcherActivated) {
    await rm(options.launcher, { force: true }).catch((error) => errors.push(error));
  }
  if (options.launcherBackedUp) {
    await rename(options.launcherBackup, options.launcher).catch((error) => errors.push(error));
  }
  if (options.stableActivated) {
    await rm(options.stableRoot, { recursive: true, force: true }).catch((error) => errors.push(error));
  }
  if (options.hadPrevious) {
    await rename(options.backupRoot, options.stableRoot).catch((error) => errors.push(error));
  }
  return errors;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
