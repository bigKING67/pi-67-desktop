import { rm } from "node:fs/promises";
import type {
  SkillPackEntry,
  SkillPackListResult,
  SkillPackMutationResult
} from "@pi67/domain";
import { HostCommandError } from "./protocol-error.js";
import type { ResourceMutationTransaction } from "./resource-management-coordinator.js";
import { activateManagedSkillPack } from "./managed-skill-pack-state.js";
import {
  compareSkillPackVersions,
  type Pi67SkillPackChannelPort
} from "./pi67-skill-pack-channel.js";
import { applyPi67UpdateCheck } from "./skill-pack-update-state.js";
import { boundedError } from "./skill-pack-validation.js";

const AI_BERKSHIRE_PACK_ID = "ai-berkshire-investment-suite";

export async function beginAiBerkshireSkillPackUpdate(options: {
  agentDir: string;
  environment: NodeJS.ProcessEnv;
  current: SkillPackEntry;
  channel: Pi67SkillPackChannelPort;
  list: () => Promise<SkillPackListResult>;
  mutationResult: (entry: SkillPackEntry, changed: boolean) => Promise<SkillPackMutationResult>;
  now: () => number;
}): Promise<ResourceMutationTransaction<SkillPackMutationResult>> {
  if (options.current.localState === "modified") {
    throw new HostCommandError(
      "INVALID_PAYLOAD",
      "The managed AI Berkshire Overlay is invalid. Restore the bundled version before installing an update.",
      false
    );
  }
  let release;
  try {
    release = await options.channel.check();
  } catch (error) {
    throw new HostCommandError("RUNTIME_NOT_READY", boundedError(error), true);
  }
  const effectiveVersion = options.current.installedVersion ?? options.current.baselineVersion;
  if (!effectiveVersion) {
    throw new HostCommandError("INTERNAL", "AI Berkshire baseline version is unavailable.", true);
  }
  if (compareSkillPackVersions(release.version, effectiveVersion) <= 0) {
    return noOpTransaction(await options.mutationResult(
      applyPi67UpdateCheck(options.current, release),
      false
    ));
  }
  if (!release.independentlyInstallable) {
    throw new HostCommandError(
      "RUNTIME_NOT_READY",
      "Pi-67 registry 尚未开放此 Skill Pack 的独立安装。",
      true
    );
  }
  const staged = await options.channel.stage(options.agentDir);
  try {
    if (compareSkillPackVersions(staged.release.version, effectiveVersion) <= 0) {
      await rm(staged.stagingSuiteRoot, { recursive: true, force: true });
      return noOpTransaction(await options.mutationResult(
        applyPi67UpdateCheck(options.current, staged.release),
        false
      ));
    }
    const swap = await activateManagedSkillPack({
      agentDir: options.agentDir,
      id: AI_BERKSHIRE_PACK_ID,
      stagingSuiteRoot: staged.stagingSuiteRoot,
      environment: options.environment
    });
    try {
      const list = await options.list();
      return {
        result: { ...list, checkedAt: options.now(), changed: true },
        commit: () => swap.commit(),
        rollback: () => swap.rollback()
      };
    } catch (error) {
      await rollbackManagedSkillPackMutation(
        swap,
        error,
        "Skill Pack Overlay 激活后的结果投影失败，且无法恢复之前的 Overlay。"
      );
      throw error;
    }
  } catch (error) {
    await rm(staged.stagingSuiteRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function noOpTransaction<T>(result: T): ResourceMutationTransaction<T> {
  return {
    result,
    commit: async () => undefined,
    rollback: async () => undefined
  };
}

async function rollbackManagedSkillPackMutation(
  swap: { rollback(): Promise<void> },
  cause: unknown,
  message: string
): Promise<void> {
  try {
    await swap.rollback();
  } catch (rollbackError) {
    throw new AggregateError([cause, rollbackError], message);
  }
}
