import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { globalAgentSkillsRoot } from "./lark-cli-resolution.js";
import type { SkillPackProcessRunner } from "./skill-pack-process-runner.js";

const GLOBAL_SKILLS_INSTALLER = "skills@1.5.22";
const GLOBAL_SKILLS_SOURCES = [
  "https://open.feishu.cn/lark-cli/skills/regular",
  "larksuite/cli"
] as const;
const SKILLS_INSTALL_TIMEOUT_MS = 60_000;
const MAX_LOCK_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_FILES = 4_096;
const MAX_SKILL_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/u;

export interface LarkGlobalSkillInstallationSwap {
  readonly changed: boolean;
  readonly installedSkillCount: number;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export type LarkGlobalSkillInstallationStrategy = "install-missing" | "replace-managed";

export async function beginGlobalLarkSkillInstallation(options: {
  homeDirectory: string;
  skillIds: string[];
  nodeExecutable: string;
  npmCli: string;
  gitExecPath: string;
  environment: NodeJS.ProcessEnv;
  runProcess: SkillPackProcessRunner;
  platform?: NodeJS.Platform;
  strategy?: LarkGlobalSkillInstallationStrategy;
}): Promise<LarkGlobalSkillInstallationSwap> {
  const skillIds = validatedSkillIds(options.skillIds);
  const targetSkillsRoot = globalAgentSkillsRoot(options.homeDirectory);
  const strategy = options.strategy ?? "install-missing";
  if (strategy === "install-missing" && (await missingSkillIds(targetSkillsRoot, skillIds)).length === 0) {
    return noOpSwap(skillIds.length);
  }

  const operationId = randomUUID();
  const stagingHome = join(resolve(options.homeDirectory), `.pi67-lark-skills.staging-${operationId}`);
  const agentsRoot = dirname(targetSkillsRoot);
  const backupRoot = join(agentsRoot, `.lark-skills.backup-${operationId}`);
  const temporaryLock = join(agentsRoot, `.skill-lock.pi67-${operationId}.json`);
  const lockPath = join(agentsRoot, ".skill-lock.json");
  const platform = options.platform ?? process.platform;

  try {
    const staged = await installStagedSkills({ ...options, platform, skillIds, stagingHome });
    const currentLock = await readExistingLock(lockPath);
    const activationIds = await activationSkillIds({
      currentLock: currentLock.value,
      skillIds,
      strategy,
      targetSkillsRoot
    });
    if (activationIds.length === 0) {
      await rm(stagingHome, { recursive: true, force: true });
      return noOpSwap(skillIds.length);
    }
    const activated: string[] = [];
    const backedUp: string[] = [];
    let lockBackedUp = false;
    let lockActivated = false;
    await mkdir(targetSkillsRoot, { recursive: true });
    await mkdir(backupRoot, { recursive: true });
    try {
      for (const skillId of activationIds) {
        const target = join(targetSkillsRoot, skillId);
        if (strategy === "install-missing" && await pathExists(target)) continue;
        if (await pathExists(target)) {
          await rename(target, join(backupRoot, skillId));
          backedUp.push(skillId);
        }
        await rename(join(staged.skillsRoot, skillId), join(targetSkillsRoot, skillId));
        activated.push(skillId);
      }
      if (activated.length === 0) {
        await rm(stagingHome, { recursive: true, force: true });
        await rm(backupRoot, { recursive: true, force: true });
        return noOpSwap(skillIds.length);
      }

      const mergedLock = mergeLocks(currentLock.value, staged.lock, activated);
      await writeFile(temporaryLock, `${JSON.stringify(mergedLock, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
      if (currentLock.exists) {
        await rename(lockPath, join(backupRoot, ".skill-lock.json"));
        lockBackedUp = true;
      }
      await rename(temporaryLock, lockPath);
      lockActivated = true;
    } catch (error) {
      await restoreActivation({
        activated,
        backedUp,
        backupRoot,
        lockActivated,
        lockBackedUp,
        lockPath,
        targetSkillsRoot,
        temporaryLock,
        cause: error
      });
      throw error;
    }

    await rm(stagingHome, { recursive: true, force: true });
    let finalized = false;
    return {
      changed: true,
      installedSkillCount: skillIds.length,
      async commit() {
        if (finalized) return;
        finalized = true;
        await rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
      },
      async rollback() {
        if (finalized) return;
        await restoreActivation({
          activated,
          backedUp,
          backupRoot,
          lockActivated: true,
          lockBackedUp,
          lockPath,
          targetSkillsRoot,
          temporaryLock
        });
        finalized = true;
      }
    };
  } catch (error) {
    await rm(stagingHome, { recursive: true, force: true }).catch(() => undefined);
    await rm(temporaryLock, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function installStagedSkills(options: {
  homeDirectory: string;
  skillIds: string[];
  nodeExecutable: string;
  npmCli: string;
  gitExecPath: string;
  environment: NodeJS.ProcessEnv;
  runProcess: SkillPackProcessRunner;
  platform: NodeJS.Platform;
  stagingHome: string;
}): Promise<{ skillsRoot: string; lock: SkillLock }> {
  const errors: unknown[] = [];
  for (const source of GLOBAL_SKILLS_SOURCES) {
    await rm(options.stagingHome, { recursive: true, force: true });
    await mkdir(options.stagingHome, { recursive: true });
    try {
      await options.runProcess(options.nodeExecutable, [
        options.npmCli,
        "exec",
        "--yes",
        `--package=${GLOBAL_SKILLS_INSTALLER}`,
        "--",
        "skills",
        "add",
        source,
        "-y",
        "-g"
      ], {
        cwd: options.stagingHome,
        timeoutMs: SKILLS_INSTALL_TIMEOUT_MS,
        environment: stagingEnvironment(
          options.environment,
          options.stagingHome,
          options.gitExecPath,
          options.platform
        )
      });
      return await validateStagedSkills(options.stagingHome, options.skillIds);
    } catch (error) {
      errors.push(error);
    }
  }
  throw new AggregateError(errors, "官方 Lark Skills 下载源均未能完成安装。");
}

function stagingEnvironment(
  source: NodeJS.ProcessEnv,
  stagingHome: string,
  gitExecPath: string,
  platform: NodeJS.Platform
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...source,
    HOME: stagingHome,
    USERPROFILE: stagingHome,
    GIT_EXEC_PATH: gitExecPath,
    npm_config_cache: join(stagingHome, ".npm-cache"),
    XDG_CONFIG_HOME: join(stagingHome, ".config"),
    XDG_DATA_HOME: join(stagingHome, ".local", "share")
  };
  if (platform === "win32") {
    environment.APPDATA = join(stagingHome, "AppData", "Roaming");
    environment.LOCALAPPDATA = join(stagingHome, "AppData", "Local");
  }
  return environment;
}

async function validateStagedSkills(stagingHome: string, expectedIds: string[]): Promise<{
  skillsRoot: string;
  lock: SkillLock;
}> {
  const skillsRoot = join(stagingHome, ".agents", "skills");
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const ids = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
    throw new Error("官方 Lark Skills 安装结果与 Desktop 验证清单不一致。");
  }

  let fileCount = 0;
  let totalBytes = 0;
  for (const skillId of ids) {
    const skillRoot = join(skillsRoot, skillId);
    await validateSkillTree(skillRoot, (size) => {
      fileCount += 1;
      totalBytes += size;
      if (fileCount > MAX_SKILL_FILES || totalBytes > MAX_SKILL_BYTES) {
        throw new Error("官方 Lark Skills 超出 Desktop 安装资源限制。");
      }
    });
    const entry = await lstat(join(skillRoot, "SKILL.md"));
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${skillId} 缺少有效 SKILL.md。`);
  }

  const lock = await readLock(join(stagingHome, ".agents", ".skill-lock.json"));
  for (const skillId of expectedIds) {
    const entry = lock.skills[skillId];
    if (!isRecord(entry) || !isOfficialSkillsSource(entry.source)) {
      throw new Error(`${skillId} 缺少官方全局安装来源记录。`);
    }
  }
  return { skillsRoot, lock };
}

async function validateSkillTree(root: string, onFile: (size: number) => void): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error("官方 Lark Skills 不能包含符号链接。");
    if (metadata.isDirectory()) await validateSkillTree(path, onFile);
    else if (metadata.isFile()) {
      if (metadata.size > MAX_FILE_BYTES) throw new Error("官方 Lark Skill 包含超限文件。");
      onFile(metadata.size);
    } else throw new Error("官方 Lark Skills 包含不支持的文件类型。");
  }
}

interface SkillLock {
  version: 3;
  skills: Record<string, unknown>;
  dismissed: Record<string, unknown>;
}

async function readExistingLock(path: string): Promise<{ exists: boolean; value: SkillLock }> {
  try {
    return { exists: true, value: await readLock(path) };
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return { exists: false, value: { version: 3, skills: {}, dismissed: {} } };
    }
    throw error;
  }
}

async function readLock(path: string): Promise<SkillLock> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_LOCK_BYTES) {
    throw new Error("全局 Skill lock 文件无效。");
  }
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (
    !isRecord(value)
    || value.version !== 3
    || !isRecord(value.skills)
    || !isRecord(value.dismissed)
  ) throw new Error("全局 Skill lock 内容无效。");
  return {
    version: 3,
    skills: value.skills,
    dismissed: value.dismissed
  };
}

function mergeLocks(current: SkillLock, staged: SkillLock, activated: string[]): SkillLock {
  const skills = { ...current.skills };
  for (const skillId of activated) skills[skillId] = staged.skills[skillId];
  return { version: 3, skills, dismissed: current.dismissed };
}

async function restoreActivation(options: {
  activated: string[];
  backedUp: string[];
  backupRoot: string;
  lockActivated: boolean;
  lockBackedUp: boolean;
  lockPath: string;
  targetSkillsRoot: string;
  temporaryLock: string;
  cause?: unknown;
}): Promise<void> {
  const errors: unknown[] = [];
  if (options.lockActivated) {
    await rm(options.lockPath, { force: true }).catch((error) => errors.push(error));
  }
  if (options.lockBackedUp) {
    await rename(join(options.backupRoot, ".skill-lock.json"), options.lockPath)
      .catch((error) => errors.push(error));
  }
  for (const skillId of options.activated) {
    await rm(join(options.targetSkillsRoot, skillId), { recursive: true, force: true })
      .catch((error) => errors.push(error));
  }
  for (const skillId of options.backedUp) {
    await rename(join(options.backupRoot, skillId), join(options.targetSkillsRoot, skillId))
      .catch((error) => errors.push(error));
  }
  await rm(options.temporaryLock, { force: true }).catch((error) => errors.push(error));
  await rm(options.backupRoot, { recursive: true, force: true }).catch((error) => errors.push(error));
  if (errors.length > 0) {
    throw new AggregateError(
      options.cause === undefined ? errors : [options.cause, ...errors],
      "全局 Lark Skills 安装失败，且无法完整恢复之前的用户级技能状态。"
    );
  }
}

async function activationSkillIds(options: {
  currentLock: SkillLock;
  skillIds: string[];
  strategy: LarkGlobalSkillInstallationStrategy;
  targetSkillsRoot: string;
}): Promise<string[]> {
  if (options.strategy === "install-missing") {
    return missingSkillIds(options.targetSkillsRoot, options.skillIds);
  }
  for (const skillId of options.skillIds) {
    const target = join(options.targetSkillsRoot, skillId);
    if (!await pathExists(target)) continue;
    const metadata = await lstat(target);
    const lockEntry = options.currentLock.skills[skillId];
    if (
      metadata.isSymbolicLink()
      || !metadata.isDirectory()
      || !isRecord(lockEntry)
      || !isOfficialSkillsSource(lockEntry.source)
    ) {
      throw new Error(`全局 Skill ${skillId} 不属于 Desktop 验证的官方来源，未覆盖现有内容。`);
    }
  }
  return options.skillIds;
}

function isOfficialSkillsSource(source: unknown): boolean {
  if (typeof source !== "string") return false;
  const normalized = source.endsWith("/") ? source.slice(0, -1) : source;
  return GLOBAL_SKILLS_SOURCES.includes(normalized as typeof GLOBAL_SKILLS_SOURCES[number]);
}

async function missingSkillIds(root: string, skillIds: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const skillId of skillIds) {
    if (!await pathExists(join(root, skillId))) missing.push(skillId);
  }
  return missing;
}

function validatedSkillIds(skillIds: string[]): string[] {
  if (
    skillIds.length === 0
    || skillIds.length > 128
    || skillIds.some((id) => !SKILL_ID_PATTERN.test(id))
    || new Set(skillIds).size !== skillIds.length
  ) throw new Error("Lark Skill 安装清单无效。");
  return [...skillIds].sort((left, right) => left.localeCompare(right));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

function noOpSwap(installedSkillCount: number): LarkGlobalSkillInstallationSwap {
  return {
    changed: false,
    installedSkillCount,
    commit: async () => undefined,
    rollback: async () => undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
