import { LARK_CLI_SKILL_PACK_ID, type SkillPackEntry, type SkillPackMutationResult } from "@pi67/domain";
import {
  type beginDesktopLarkSkillSynchronization,
  LarkCliInstallationError,
  type beginDesktopLarkCliInstallation,
  type LarkCliInstallationSwap
} from "./lark-cli-installation.js";
import { HostCommandError } from "./protocol-error.js";
import type { ResourceMutationTransaction } from "./resource-management-coordinator.js";
import type { SkillPackProcessRunner } from "./skill-pack-process-runner.js";

export async function beginLarkSkillPackInstallation(options: {
  id: string;
  homeDirectory: string;
  skillIds: string[];
  environment: NodeJS.ProcessEnv;
  runProcess: SkillPackProcessRunner;
  resolveLarkCli: () => Promise<string | undefined>;
  installLarkCli: typeof beginDesktopLarkCliInstallation;
  synchronizeLarkSkills: typeof beginDesktopLarkSkillSynchronization;
  checkEntry: (executable: string) => Promise<SkillPackEntry>;
  mutationResult: (
    entry: SkillPackEntry,
    changed: boolean,
    executable: string
  ) => Promise<SkillPackMutationResult>;
}): Promise<ResourceMutationTransaction<SkillPackMutationResult>> {
  if (options.id !== LARK_CLI_SKILL_PACK_ID) {
    throw new HostCommandError("INVALID_PAYLOAD", "This Skill Pack cannot be installed independently.", false);
  }
  const existing = await options.resolveLarkCli();
  if (existing) {
    const current = await options.checkEntry(existing);
    if (!current.canInstall && current.installedSkillCount >= options.skillIds.length) {
      return noOpTransaction(await options.mutationResult(current, false, existing));
    }
    let skillsSwap: Awaited<ReturnType<typeof beginDesktopLarkSkillSynchronization>>;
    try {
      skillsSwap = await options.synchronizeLarkSkills({
        homeDirectory: options.homeDirectory,
        skillIds: options.skillIds,
        environment: options.environment,
        runProcess: options.runProcess,
        strategy: "install-missing"
      });
    } catch (error) {
      if (error instanceof LarkCliInstallationError) throw installationFailure(error);
      throw error;
    }
    try {
      const checked = await options.checkEntry(existing);
      if (
        checked.managerStatus !== "ready"
        || checked.updateStatus === "sync-pending"
        || checked.updateStatus === "unavailable"
        || checked.canInstall
        || checked.installedSkillCount < options.skillIds.length
      ) {
        throw new HostCommandError(
          "INTERNAL",
          "Official Lark Skills synchronization did not converge at the user-global installation.",
          true
        );
      }
      return {
        result: await options.mutationResult(checked, skillsSwap.changed, existing),
        commit: () => skillsSwap.commit(),
        rollback: () => skillsSwap.rollback()
      };
    } catch (error) {
      await skillsSwap.rollback().catch((rollbackError) => {
        throw new AggregateError([error, rollbackError], "Lark Skills 同步失败，且无法恢复之前的全局技能。");
      });
      throw error;
    }
  }

  let swap: LarkCliInstallationSwap;
  try {
    swap = await options.installLarkCli({
      homeDirectory: options.homeDirectory,
      skillIds: options.skillIds,
      environment: options.environment,
      runProcess: options.runProcess,
      operation: "install"
    });
  } catch (error) {
    if (error instanceof LarkCliInstallationError) throw installationFailure(error);
    throw error;
  }

  try {
    const checked = await options.checkEntry(swap.executable);
    if (swap.skills?.state === "pending") {
      const pending = pendingSkillsEntry(checked, swap.version, swap.skills.detail);
      return {
        result: await options.mutationResult(pending, true, swap.executable),
        commit: () => swap.commit(),
        rollback: () => swap.rollback()
      };
    }
    if (
      checked.managerStatus !== "ready"
      || checked.updateStatus === "unavailable"
      || checked.localState === "modified"
      || checked.canInstall
      || checked.installedSkillCount < options.skillIds.length
    ) {
      throw new HostCommandError(
        "INTERNAL",
        "Lark CLI installation did not converge at the activated Desktop-managed installation.",
        true
      );
    }
    return {
      result: await options.mutationResult(checked, true, swap.executable),
      commit: () => swap.commit(),
      rollback: () => swap.rollback()
    };
  } catch (error) {
    try {
      await swap.rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Lark CLI 安装结果验证失败，且无法恢复之前的安装。"
      );
    }
    throw error;
  }
}

export async function beginDesktopManagedLarkSkillPackUpdate(options: {
  homeDirectory: string;
  skillIds: string[];
  installedVersion: string;
  targetVersion: string;
  environment: NodeJS.ProcessEnv;
  runProcess: SkillPackProcessRunner;
  installLarkCli: typeof beginDesktopLarkCliInstallation;
  checkEntry: (executable: string) => Promise<SkillPackEntry>;
  mutationResult: (
    entry: SkillPackEntry,
    changed: boolean,
    executable: string
  ) => Promise<SkillPackMutationResult>;
}): Promise<ResourceMutationTransaction<SkillPackMutationResult>> {
  let swap: LarkCliInstallationSwap;
  try {
    swap = await options.installLarkCli({
      homeDirectory: options.homeDirectory,
      skillIds: options.skillIds,
      environment: options.environment,
      runProcess: options.runProcess,
      operation: "update",
      targetVersion: options.targetVersion,
      minimumVersion: options.installedVersion
    });
  } catch (error) {
    if (error instanceof LarkCliInstallationError) throw installationFailure(error);
    throw error;
  }

  try {
    const checked = await options.checkEntry(swap.executable);
    if (swap.skills?.state === "pending") {
      const pending = pendingSkillsEntry(checked, swap.version, swap.skills.detail);
      return {
        result: await options.mutationResult(pending, true, swap.executable),
        commit: () => swap.commit(),
        rollback: () => swap.rollback()
      };
    }
    if (
      checked.managerStatus !== "ready"
      || checked.updateStatus !== "current"
      || checked.localState !== "clean"
    ) {
      throw new HostCommandError(
        "INTERNAL",
        "The Desktop-managed Lark CLI update did not converge at the activated user-global installation.",
        true
      );
    }
    return {
      result: await options.mutationResult(checked, true, swap.executable),
      commit: () => swap.commit(),
      rollback: () => swap.rollback()
    };
  } catch (error) {
    try {
      await swap.rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Lark CLI 更新结果验证失败，且无法恢复之前的用户级安装。"
      );
    }
    throw error;
  }
}

function pendingSkillsEntry(entry: SkillPackEntry, version: string, detail?: string): SkillPackEntry {
  return {
    ...entry,
    managerStatus: "ready",
    updateStatus: "sync-pending",
    localState: "clean",
    installedVersion: version,
    latestVersion: version,
    canInstall: true,
    canUpdate: false,
    detail: detail ?? "Lark CLI 已更新；官方全局 Skills 待同步。"
  };
}

function installationFailure(error: LarkCliInstallationError): HostCommandError {
  const cleanupCompromised = error.stage === "recovery";
  return new HostCommandError(
    cleanupCompromised
      ? "RUNTIME_POISONED"
      : error.stage === "toolchain"
        ? "TOOLCHAIN_MISSING"
        : "RUNTIME_NOT_READY",
    error.message,
    error.stage !== "toolchain" && !cleanupCompromised,
    {
      installationStage: error.stage,
      ...(cleanupCompromised ? { resourceStateConsistent: false } : {})
    }
  );
}

function noOpTransaction<T>(result: T): ResourceMutationTransaction<T> {
  return {
    result,
    commit: async () => undefined,
    rollback: async () => undefined
  };
}
