import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  PiWorkspaceRuntimeServices
} from "@pi67/pi-runtime";
import type {
  SkillPackEntry,
  SkillPackListResult,
  SkillPackMutationResult
} from "@pi67/domain";
import { LARK_CLI_SKILL_PACK_ID } from "@pi67/domain";
import { HostCommandError } from "./protocol-error.js";
import type { ResourceMutationTransaction } from "./resource-management-coordinator.js";
import {
  beginDesktopLarkCliInstallation
} from "./lark-cli-installation.js";
import {
  beginDesktopManagedLarkSkillPackUpdate,
  beginLarkSkillPackInstallation
} from "./lark-skill-pack-installation.js";
import {
  isDesktopManagedLarkCliExecutable,
  larkCliProcessEnvironment,
  resolveLarkCli,
  resolveOptionalPath
} from "./lark-cli-resolution.js";
import {
  activateManagedSkillPack,
  inspectManagedSkillPack,
  removeManagedSkillPack
} from "./managed-skill-pack-state.js";
import {
  compareSkillPackVersions,
  createPi67SkillPackChannel,
  type Pi67SkillPackChannelPort,
  type Pi67SkillPackRelease
} from "./pi67-skill-pack-channel.js";
import {
  runBoundedSkillPackProcess,
  type SkillPackProcessRunner
} from "./skill-pack-process-runner.js";
import {
  countInstalledSkills,
  readLarkSuite,
  readSkillSuite
} from "./skill-pack-catalog.js";
import {
  applyLarkUpdateCheck,
  applyPi67UpdateCheck,
  parseLarkUpdateResult
} from "./skill-pack-update-state.js";
import { boundedError } from "./skill-pack-validation.js";

const AI_BERKSHIRE_PACK_ID = "ai-berkshire-investment-suite";
const CHECK_TIMEOUT_MS = 60_000;

export interface SkillPackManagementPort {
  list(): Promise<SkillPackListResult>;
  checkForUpdates(): Promise<SkillPackListResult>;
  beginInstall(id: string): Promise<ResourceMutationTransaction<SkillPackMutationResult>>;
  beginUpdate(id: string): Promise<ResourceMutationTransaction<SkillPackMutationResult>>;
  beginRestore(id: string): Promise<ResourceMutationTransaction<SkillPackMutationResult>>;
}

export interface SkillPackManagementOptions {
  capabilitiesRoot?: string;
  homeDirectory?: string;
  environment?: NodeJS.ProcessEnv;
  now?: () => number;
  resolveLarkCli?: () => Promise<string | undefined>;
  runProcess?: SkillPackProcessRunner;
  installLarkCli?: typeof beginDesktopLarkCliInstallation;
  pi67Channel?: Pi67SkillPackChannelPort;
}

export function createSkillPackManagement(
  services: PiWorkspaceRuntimeServices,
  options: SkillPackManagementOptions = {}
): SkillPackManagementPort {
  return new SkillPackManagement(services, options);
}

export class SkillPackManagement implements SkillPackManagementPort {
  readonly #environment: NodeJS.ProcessEnv;
  readonly #homeDirectory: string;
  readonly #capabilitiesRoot: string | undefined;
  readonly #now: () => number;
  readonly #runProcess: NonNullable<SkillPackManagementOptions["runProcess"]>;
  readonly #resolveLarkCli: () => Promise<string | undefined>;
  readonly #installLarkCli: NonNullable<SkillPackManagementOptions["installLarkCli"]>;
  readonly #pi67Channel: Pi67SkillPackChannelPort;

  constructor(
    private readonly services: PiWorkspaceRuntimeServices,
    options: SkillPackManagementOptions = {}
  ) {
    this.#environment = options.environment ?? process.env;
    this.#homeDirectory = resolve(options.homeDirectory ?? homedir());
    this.#capabilitiesRoot = resolveOptionalPath(
      options.capabilitiesRoot ?? this.#environment.PI67_CAPABILITIES_ROOT
    );
    this.#now = options.now ?? Date.now;
    this.#runProcess = options.runProcess ?? runBoundedSkillPackProcess;
    this.#installLarkCli = options.installLarkCli ?? beginDesktopLarkCliInstallation;
    this.#pi67Channel = options.pi67Channel ?? createPi67SkillPackChannel({
      environment: this.#environment,
      runProcess: this.#runProcess,
      now: this.#now
    });
    this.#resolveLarkCli = options.resolveLarkCli ?? (() => resolveLarkCli({
      environment: this.#environment,
      homeDirectory: this.#homeDirectory,
      shellPath: this.services.settingsManager.getShellPath(),
      runProcess: this.#runProcess
    }));
  }

  async list(): Promise<SkillPackListResult> {
    const [lark, aiBerkshire] = await Promise.all([this.#larkEntry(), this.#aiBerkshireEntry()]);
    const items = [lark, aiBerkshire];
    return { items, total: items.length };
  }

  async checkForUpdates(): Promise<SkillPackListResult> {
    const checkedAt = this.#now();
    const [lark, aiBerkshire] = await Promise.all([
      this.#checkLarkEntry(),
      this.#checkAiBerkshireEntry()
    ]);
    const items = [lark, aiBerkshire];
    return { items, total: items.length, checkedAt };
  }

  async beginInstall(id: string): Promise<ResourceMutationTransaction<SkillPackMutationResult>> {
    if (id !== LARK_CLI_SKILL_PACK_ID) {
      throw new HostCommandError("INVALID_PAYLOAD", "This Skill Pack cannot be installed independently.", false);
    }
    const suite = await readLarkSuite(this.#capabilitiesRoot);
    return beginLarkSkillPackInstallation({
      id,
      homeDirectory: this.#homeDirectory,
      skillIds: suite.skillIds,
      environment: this.#environment,
      runProcess: this.#runProcess,
      resolveLarkCli: this.#resolveLarkCli,
      installLarkCli: this.#installLarkCli,
      checkEntry: (executable) => this.#checkLarkEntry(executable),
      mutationResult: (entry, changed) => this.#mutationResultWithEntry(entry, changed)
    });
  }

  async beginUpdate(id: string): Promise<ResourceMutationTransaction<SkillPackMutationResult>> {
    if (id === LARK_CLI_SKILL_PACK_ID) return this.#beginLarkUpdate();
    if (id === AI_BERKSHIRE_PACK_ID) return this.#beginAiBerkshireUpdate();
    throw new HostCommandError("INVALID_PAYLOAD", "The managed Skill Pack is not supported.", false);
  }

  async beginRestore(id: string): Promise<ResourceMutationTransaction<SkillPackMutationResult>> {
    if (id !== AI_BERKSHIRE_PACK_ID) {
      throw new HostCommandError("INVALID_PAYLOAD", "This Skill Pack cannot be restored to a bundled version.", false);
    }
    const removed = await removeManagedSkillPack({
      agentDir: this.services.agentDir,
      id,
      environment: this.#environment
    });
    try {
      const list = await this.list();
      return {
        result: { ...list, checkedAt: this.#now(), changed: removed.changed },
        commit: () => removed.swap.commit(),
        rollback: () => removed.swap.rollback()
      };
    } catch (error) {
      await rollbackManagedSkillPackMutation(
        removed.swap,
        error,
        "恢复内置 Skill Pack 时结果投影失败，且无法恢复原 Overlay。"
      );
      throw error;
    }
  }

  async #beginLarkUpdate(): Promise<ResourceMutationTransaction<SkillPackMutationResult>> {
    const executable = await this.#requireLarkCli();
    const installed = await this.#larkEntryForExecutable(executable);
    if (!installed.installed) {
      throw new HostCommandError("RUNTIME_NOT_READY", "The Lark CLI Skill Pack is not installed.", true);
    }
    const current = await this.#checkLarkEntry(executable);
    if (current.localState === "modified") {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "The Lark CLI Skill Pack has local changes and cannot be overwritten automatically.",
        false
      );
    }
    if (current.updateStatus !== "update-available") {
      if (current.updateStatus === "current") {
        return noOpTransaction(await this.#mutationResultWithEntry(current, false));
      }
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        current.detail ?? "The Lark CLI Skill Pack update is not currently available.",
        true
      );
    }
    if (!current.canUpdate) {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        current.detail ?? "The Lark CLI Skill Pack cannot be updated in its current state.",
        true
      );
    }
    if (!current.installedVersion || !current.latestVersion) {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "Lark CLI 更新通道缺少可验证的当前版本或目标版本，已取消更新。",
        true
      );
    }
    const suite = await readLarkSuite(this.#capabilitiesRoot);
    return beginDesktopManagedLarkSkillPackUpdate({
      homeDirectory: this.#homeDirectory,
      skillIds: suite.skillIds,
      installedVersion: current.installedVersion,
      targetVersion: current.latestVersion,
      environment: this.#environment,
      runProcess: this.#runProcess,
      installLarkCli: this.#installLarkCli,
      checkEntry: (updatedExecutable) => this.#checkLarkEntry(updatedExecutable),
      mutationResult: (entry, changed) => this.#mutationResultWithEntry(entry, changed)
    });
  }

  async #beginAiBerkshireUpdate(): Promise<ResourceMutationTransaction<SkillPackMutationResult>> {
    const current = await this.#aiBerkshireEntry();
    if (current.localState === "modified") {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "The managed AI Berkshire Overlay is invalid. Restore the bundled version before installing an update.",
        false
      );
    }
    let release: Pi67SkillPackRelease;
    try {
      release = await this.#pi67Channel.check();
    } catch (error) {
      throw new HostCommandError("RUNTIME_NOT_READY", boundedError(error), true);
    }
    const effectiveVersion = current.installedVersion ?? current.baselineVersion;
    if (!effectiveVersion) throw new HostCommandError("INTERNAL", "AI Berkshire baseline version is unavailable.", true);
    if (compareSkillPackVersions(release.version, effectiveVersion) <= 0) {
      const checked = applyPi67UpdateCheck(current, release);
      return noOpTransaction(await this.#mutationResultWithEntry(checked, false));
    }
    if (!release.independentlyInstallable) {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "Pi-67 registry 尚未开放此 Skill Pack 的独立安装。",
        true
      );
    }
    const staged = await this.#pi67Channel.stage(this.services.agentDir);
    try {
      if (compareSkillPackVersions(staged.release.version, effectiveVersion) <= 0) {
        await rm(staged.stagingSuiteRoot, { recursive: true, force: true });
        const checked = applyPi67UpdateCheck(current, staged.release);
        return noOpTransaction(await this.#mutationResultWithEntry(checked, false));
      }
      const swap = await activateManagedSkillPack({
        agentDir: this.services.agentDir,
        id: AI_BERKSHIRE_PACK_ID,
        stagingSuiteRoot: staged.stagingSuiteRoot,
        environment: this.#environment
      });
      try {
        const list = await this.list();
        return {
          result: { ...list, checkedAt: this.#now(), changed: true },
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

  async #larkEntry(): Promise<SkillPackEntry> {
    return this.#larkEntryForExecutable(await this.#resolveLarkCli());
  }

  async #larkEntryForExecutable(executable: string | undefined): Promise<SkillPackEntry> {
    const suite = await readLarkSuite(this.#capabilitiesRoot);
    const roots = [
      join(this.#homeDirectory, ".agents", "skills"),
      join(this.services.agentDir, "skills")
    ];
    const [installedSkillCount, globallyInstalledSkillCount] = await Promise.all([
      countInstalledSkills(suite.skillIds, roots),
      countInstalledSkills(suite.skillIds, [roots[0]!])
    ]);
    const canInstall = executable === undefined || globallyInstalledSkillCount < suite.skillIds.length;
    return {
      id: LARK_CLI_SKILL_PACK_ID,
      suiteId: suite.id,
      displayName: suite.displayName,
      description: suite.description,
      manager: "lark-cli",
      managerStatus: executable ? "ready" : "missing",
      updateOwner: "managed-pack",
      updateStatus: executable ? "not-checked" : "not-installed",
      localState: "unknown",
      provenance: "verified",
      installed: installedSkillCount > 0,
      installedSkillCount,
      skillIds: suite.skillIds,
      canInstall,
      canUpdate: false,
      effectiveSource: "managed",
      canRestore: false,
      source: "@larksuite/cli",
      detail: executable
        ? canInstall
          ? "官方办公 Skills 尚未完整安装到 ~/.agents/skills；确认安装后可供 Pi-67 与其他兼容 Agent 共享。"
          : "点击检查更新后，由 Lark CLI 验证版本和官方技能同步状态。"
        : "需要先安装官方 Lark CLI，才能检查技能更新、准备飞书连接和进行用户授权。"
    };
  }

  async #aiBerkshireEntry(): Promise<SkillPackEntry> {
    const suite = await readSkillSuite(this.#capabilitiesRoot, AI_BERKSHIRE_PACK_ID);
    if (!suite.bundledVersion || !suite.upstream || !suite.sourceCommit) {
      throw new Error("AI Berkshire Skill suite provenance is missing from the capability catalog.");
    }
    const managed = await inspectManagedSkillPack(this.services.agentDir, AI_BERKSHIRE_PACK_ID);
    const valid = managed.status === "valid" ? managed : undefined;
    const skillIds = valid?.state.skills.map((skill) => skill.name) ?? suite.skillIds;
    return {
      id: AI_BERKSHIRE_PACK_ID,
      suiteId: suite.id,
      displayName: suite.displayName,
      description: suite.description,
      manager: "pi67-desktop",
      managerStatus: "ready",
      updateOwner: "managed-pack",
      updateStatus: "not-checked",
      localState: managed.status === "invalid" ? "modified" : "clean",
      provenance: managed.status === "invalid" ? "unverified" : "verified",
      installed: true,
      installedSkillCount: skillIds.length,
      skillIds,
      canInstall: false,
      canUpdate: false,
      effectiveSource: valid ? "managed" : "bundled",
      canRestore: managed.status !== "absent",
      baselineVersion: suite.bundledVersion,
      installedVersion: valid?.state.version ?? suite.bundledVersion,
      ...(valid ? { registryCommit: valid.state.registryCommit } : {}),
      source: suite.upstream,
      detail: managed.status === "invalid"
        ? `${managed.detail} 当前继续使用已验证的内置版本，可恢复内置版本以清理损坏的 Overlay。`
        : valid
          ? "当前使用 Pi-67 官方 registry 安装的受管 Overlay。"
          : "当前使用随 Desktop 发布的不可变内置基线。"
    };
  }

  async #checkLarkEntry(executableOverride?: string): Promise<SkillPackEntry> {
    const executable = executableOverride ?? await this.#resolveLarkCli();
    const entry = await this.#larkEntryForExecutable(executable);
    if (!executable) return entry;
    try {
      const result = await this.#runProcess(executable, ["update", "--check", "--json"], {
        cwd: this.#homeDirectory,
        timeoutMs: CHECK_TIMEOUT_MS,
        environment: larkCliProcessEnvironment(this.#environment, executable)
      });
      const checked = applyLarkUpdateCheck(entry, parseLarkUpdateResult(result.stdout), {
        desktopManaged: isDesktopManagedLarkCliExecutable(executable, this.#homeDirectory)
      });
      return entry.canInstall
        ? {
            ...checked,
            canUpdate: false,
            detail: "请先将官方办公 Skills 安装到 ~/.agents/skills，再检查整套更新状态。"
          }
        : checked;
    } catch (error) {
      return { ...entry, updateStatus: "unavailable", canUpdate: false, detail: boundedError(error) };
    }
  }

  async #checkAiBerkshireEntry(): Promise<SkillPackEntry> {
    const entry = await this.#aiBerkshireEntry();
    try {
      return applyPi67UpdateCheck(entry, await this.#pi67Channel.check());
    } catch (error) {
      return { ...entry, updateStatus: "unavailable", canUpdate: false, detail: boundedError(error) };
    }
  }

  async #mutationResultWithEntry(
    entry: SkillPackEntry,
    changed: boolean
  ): Promise<SkillPackMutationResult> {
    const list = await this.list();
    const items = list.items.map((candidate) => candidate.id === entry.id ? entry : candidate);
    return { items, total: items.length, checkedAt: this.#now(), changed };
  }

  async #requireLarkCli(): Promise<string> {
    const executable = await this.#resolveLarkCli();
    if (!executable) {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "未找到 lark-cli。请先安装 Lark CLI，再检查官方技能更新。",
        true
      );
    }
    return executable;
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
