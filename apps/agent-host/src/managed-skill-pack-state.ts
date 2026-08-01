import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  hashManagedSkillSet,
  managedPackageTreeSha256
} from "./managed-skill-pack-integrity.js";

export { hashManagedSkillSet, managedPackageTreeSha256 } from "./managed-skill-pack-integrity.js";

const STATE_SCHEMA = "pi67.managed-skill-pack-state.v1";
const MAX_STATE_BYTES = 128 * 1024;
const MAX_MANAGED_PACKS = 16;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

export interface ManagedSkillPackState {
  schema: typeof STATE_SCHEMA;
  id: string;
  version: string;
  upstream: string;
  sourceCommit: string;
  registryCommit: string;
  manifestSha256: string;
  bundleSha256: string;
  packageTreeSha256: string;
  skills: Array<{ name: string; sha256: string }>;
  activatedAt: number;
}

export type ManagedSkillPackInspection =
  | { status: "absent"; root: string; packagePath: string }
  | { status: "invalid"; root: string; packagePath: string; detail: string }
  | { status: "valid"; root: string; packagePath: string; state: ManagedSkillPackState };

export interface ManagedSkillPackSwap {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export function managedSkillPackRoot(agentDir: string, id: string): string {
  assertPackId(id);
  return join(resolve(agentDir), "desktop-capabilities", "skill-packs", id);
}

export async function inspectManagedSkillPack(
  agentDir: string,
  id: string
): Promise<ManagedSkillPackInspection> {
  const root = managedSkillPackRoot(agentDir, id);
  const packagePath = join(root, "package");
  try {
    const rootMetadata = await lstat(root);
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
      return { status: "invalid", root, packagePath, detail: "受管 Overlay 根目录无效。" };
    }
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { status: "absent", root, packagePath };
    return { status: "invalid", root, packagePath, detail: boundedError(error) };
  }
  try {
    const value = await readBoundedJson(join(root, "state.json"));
    const state = parseManagedSkillPackState(value, id);
    if (!state) throw new Error("受管 Overlay 状态无效。");
    const packageMetadata = await lstat(packagePath);
    if (packageMetadata.isSymbolicLink() || !packageMetadata.isDirectory()) {
      throw new Error("受管 Overlay Package 无效。");
    }
    await validatePackageManifest(packagePath, state);
    const packageTreeSha256 = await managedPackageTreeSha256(packagePath);
    if (packageTreeSha256 !== state.packageTreeSha256) {
      throw new Error("受管 Overlay Package 完整性校验失败。");
    }
    return { status: "valid", root, packagePath, state };
  } catch (error) {
    return { status: "invalid", root, packagePath, detail: boundedError(error) };
  }
}

export async function writeManagedSkillPackState(
  stagingSuiteRoot: string,
  input: Omit<ManagedSkillPackState, "schema" | "packageTreeSha256" | "activatedAt">,
  now: () => number = Date.now
): Promise<ManagedSkillPackState> {
  const root = resolve(stagingSuiteRoot);
  const packagePath = join(root, "package");
  const state: ManagedSkillPackState = {
    schema: STATE_SCHEMA,
    ...input,
    packageTreeSha256: await managedPackageTreeSha256(packagePath),
    activatedAt: now()
  };
  if (!parseManagedSkillPackState(state, input.id)) throw new Error("受管 Overlay 状态无效。");
  await writeFile(join(root, "state.json"), `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  return state;
}

export async function activateManagedSkillPack(options: {
  agentDir: string;
  id: string;
  stagingSuiteRoot: string;
  environment?: NodeJS.ProcessEnv;
  createToken?: () => string;
}): Promise<ManagedSkillPackSwap> {
  const environment = options.environment ?? process.env;
  const root = managedSkillPackRoot(options.agentDir, options.id);
  const parent = dirname(root);
  const staging = resolve(options.stagingSuiteRoot);
  if (dirname(staging) !== parent || basename(staging) === options.id || !isContained(staging, parent)) {
    throw new Error("受管 Overlay staging 路径无效。");
  }
  const staged = await inspectManagedSkillPackAtRoot(staging, options.id);
  if (!staged) throw new Error("受管 Overlay staging 完整性校验失败。");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const backup = join(parent, `.${options.id}.${process.pid}.${(options.createToken ?? randomUUID)()}.backup`);
  let backedUp = false;
  let activated = false;
  try {
    try {
      await rename(root, backup);
      backedUp = true;
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    await rename(staging, root);
    activated = true;
    await refreshManagedSkillPackEnvironment(options.agentDir, environment);
  } catch (error) {
    await restoreFailedActivation({
      agentDir: options.agentDir,
      root,
      backup,
      backedUp,
      activated,
      environment,
      cause: error
    });
    throw error;
  }
  let settled = false;
  return {
    commit: async () => {
      if (settled) return;
      if (backedUp) await rm(backup, { recursive: true, force: true });
      settled = true;
    },
    rollback: async () => {
      if (settled) return;
      await rm(root, { recursive: true, force: true });
      if (backedUp) await rename(backup, root);
      await refreshManagedSkillPackEnvironment(options.agentDir, environment);
      settled = true;
    }
  };
}

export async function removeManagedSkillPack(options: {
  agentDir: string;
  id: string;
  environment?: NodeJS.ProcessEnv;
  createToken?: () => string;
}): Promise<{ changed: boolean; swap: ManagedSkillPackSwap }> {
  const environment = options.environment ?? process.env;
  const root = managedSkillPackRoot(options.agentDir, options.id);
  const parent = dirname(root);
  const backup = join(parent, `.${options.id}.${process.pid}.${(options.createToken ?? randomUUID)()}.backup`);
  try {
    await rename(root, backup);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return { changed: false, swap: noOpSwap() };
    }
    throw error;
  }
  try {
    await refreshManagedSkillPackEnvironment(options.agentDir, environment);
  } catch (error) {
    try {
      await rename(backup, root);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        "受管 Overlay 移除失败，且无法恢复原 Overlay。"
      );
    }
    throw error;
  }
  let settled = false;
  return {
    changed: true,
    swap: {
      commit: async () => {
        if (settled) return;
        await rm(backup, { recursive: true, force: true });
        settled = true;
      },
      rollback: async () => {
        if (settled) return;
        await rename(backup, root);
        await refreshManagedSkillPackEnvironment(options.agentDir, environment);
        settled = true;
      }
    }
  };
}

export async function managedSkillPackPackagePaths(agentDir: string): Promise<string[]> {
  const parent = join(resolve(agentDir), "desktop-capabilities", "skill-packs");
  let entries;
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  }
  const ids = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (ids.length > MAX_MANAGED_PACKS) return [];
  const paths: string[] = [];
  for (const id of ids) {
    const inspection = await inspectManagedSkillPack(agentDir, id);
    if (inspection.status === "valid") paths.push(inspection.packagePath);
  }
  return paths;
}

async function refreshManagedSkillPackEnvironment(
  agentDir: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  const managedRoot = join(resolve(agentDir), "desktop-capabilities");
  const overlayRoot = join(managedRoot, "skill-packs");
  const overlays = await managedSkillPackPackagePaths(agentDir);
  const existing = parsePackagePaths(environment.PI67_CAPABILITY_PACKAGE_PATHS);
  const bundled = existing.filter((path) => !isContained(path, overlayRoot));
  const packagePaths = [...overlays, ...bundled];
  environment.PI67_MANAGED_CAPABILITIES_ROOT = managedRoot;
  environment.PI67_CAPABILITY_PACKAGE_PATHS = JSON.stringify(packagePaths);
  return packagePaths;
}

async function inspectManagedSkillPackAtRoot(
  root: string,
  expectedId: string
): Promise<ManagedSkillPackState | undefined> {
  try {
    const value = await readBoundedJson(join(root, "state.json"));
    const state = parseManagedSkillPackState(value, expectedId);
    if (!state) return undefined;
    const packagePath = join(root, "package");
    await validatePackageManifest(packagePath, state);
    return await managedPackageTreeSha256(packagePath) === state.packageTreeSha256 ? state : undefined;
  } catch {
    return undefined;
  }
}

async function validatePackageManifest(packagePath: string, state: ManagedSkillPackState): Promise<void> {
  const value = await readBoundedJson(join(packagePath, "package.json"));
  if (!isRecord(value) || value.version !== state.version || !isRecord(value.pi)) {
    throw new Error("受管 Overlay package.json 无效。");
  }
  const skills = value.pi.skills;
  const expected = state.skills.map((skill) => `skills/${skill.name}`);
  if (!Array.isArray(skills) || JSON.stringify(skills) !== JSON.stringify(expected)) {
    throw new Error("受管 Overlay Skill 清单无效。");
  }
}

function parseManagedSkillPackState(value: unknown, expectedId: string): ManagedSkillPackState | undefined {
  if (
    !isRecord(value)
    || value.schema !== STATE_SCHEMA
    || value.id !== expectedId
    || !ID_PATTERN.test(expectedId)
    || typeof value.version !== "string"
    || !VERSION_PATTERN.test(value.version)
    || !isHttpsUrl(value.upstream)
    || typeof value.sourceCommit !== "string"
    || !COMMIT_PATTERN.test(value.sourceCommit)
    || typeof value.registryCommit !== "string"
    || !COMMIT_PATTERN.test(value.registryCommit)
    || typeof value.manifestSha256 !== "string"
    || !SHA256_PATTERN.test(value.manifestSha256)
    || typeof value.bundleSha256 !== "string"
    || !SHA256_PATTERN.test(value.bundleSha256)
    || typeof value.packageTreeSha256 !== "string"
    || !SHA256_PATTERN.test(value.packageTreeSha256)
    || !Number.isSafeInteger(value.activatedAt)
    || Number(value.activatedAt) < 0
    || !Array.isArray(value.skills)
    || value.skills.length === 0
    || value.skills.length > 256
  ) return undefined;
  const skills: Array<{ name: string; sha256: string }> = [];
  for (const skill of value.skills) {
    if (
      !isRecord(skill)
      || typeof skill.name !== "string"
      || !ID_PATTERN.test(skill.name)
      || typeof skill.sha256 !== "string"
      || !SHA256_PATTERN.test(skill.sha256)
    ) {
      return undefined;
    }
    skills.push({ name: skill.name, sha256: skill.sha256 });
  }
  if (new Set(skills.map((skill) => skill.name)).size !== skills.length) return undefined;
  if (hashManagedSkillSet(skills) !== value.bundleSha256) return undefined;
  return {
    schema: STATE_SCHEMA,
    id: expectedId,
    version: value.version,
    upstream: value.upstream,
    sourceCommit: value.sourceCommit,
    registryCommit: value.registryCommit,
    manifestSha256: value.manifestSha256,
    bundleSha256: value.bundleSha256,
    packageTreeSha256: value.packageTreeSha256,
    skills,
    activatedAt: Number(value.activatedAt)
  };
}

function parsePackagePaths(serialized: string | undefined): string[] {
  if (!serialized) return [];
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!Array.isArray(value) || value.length > 32 || value.some((path) => typeof path !== "string" || !isAbsolute(path))) {
      throw new Error("Desktop capability package paths are invalid.");
    }
    return value;
  } catch (error) {
    throw new Error(`Desktop capability package paths are invalid: ${boundedError(error)}`);
  }
}

async function readBoundedJson(path: string): Promise<unknown> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_STATE_BYTES) {
    throw new Error("受管 Overlay 元数据文件无效。");
  }
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function noOpSwap(): ManagedSkillPackSwap {
  return { commit: async () => undefined, rollback: async () => undefined };
}

async function restoreFailedActivation(options: {
  agentDir: string;
  root: string;
  backup: string;
  backedUp: boolean;
  activated: boolean;
  environment: NodeJS.ProcessEnv;
  cause: unknown;
}): Promise<void> {
  const recoveryErrors: unknown[] = [];
  if (options.activated) {
    try {
      await rm(options.root, { recursive: true, force: true });
    } catch (error) {
      recoveryErrors.push(error);
    }
  }
  if (options.backedUp) {
    try {
      await rename(options.backup, options.root);
    } catch (error) {
      recoveryErrors.push(error);
    }
  }
  try {
    await refreshManagedSkillPackEnvironment(options.agentDir, options.environment);
  } catch (error) {
    recoveryErrors.push(error);
  }
  if (recoveryErrors.length > 0) {
    throw new AggregateError(
      [options.cause, ...recoveryErrors],
      "受管 Overlay 激活失败，且无法完整恢复之前的 Overlay 状态。"
    );
  }
}

function assertPackId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new Error("受管 Skill Pack ID 无效。");
}

function isContained(candidate: string, root: string): boolean {
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLowerCase()
    : (value: string) => resolve(value);
  const fromRoot = relative(normalize(root), normalize(candidate));
  return fromRoot !== ""
    && fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function boundedError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  let sanitized = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    sanitized += code <= 31 || code === 127 ? " " : character;
  }
  return sanitized.replace(/\s+/gu, " ").trim().slice(0, 500)
    || "受管 Overlay 状态不可用。";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
