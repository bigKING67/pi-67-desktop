import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  hashManagedSkillSet,
  managedPackageTreeSha256,
  managedSkillPackRoot,
  writeManagedSkillPackState
} from "./managed-skill-pack-state.js";
import {
  runBoundedSkillPackProcess,
  type SkillPackProcessRunner
} from "./skill-pack-process-runner.js";

const PI67_REPOSITORY = "https://github.com/bigKING67/pi-67.git";
const PI67_RAW_ROOT = "https://raw.githubusercontent.com/bigKING67/pi-67";
const REGISTRY_PATH = "shared-skill-packs.json";
const LOCK_PATH = "shared-skill-packs.lock.json";
const PACK_ID = "ai-berkshire-investment-suite";
const MAX_METADATA_BYTES = 512 * 1024;
const CHECK_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = 30_000;
const UPDATE_TIMEOUT_MS = 5 * 60_000;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const SKILL_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const IGNORED_DIRECTORIES = new Set(["__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"]);

export interface Pi67SkillPackRelease {
  id: typeof PACK_ID;
  version: string;
  upstream?: string;
  sourceCommit: string;
  registryCommit: string;
  manifestSha256: string;
  bundleSha256: string;
  skills: Array<{ name: string; sha256: string }>;
  independentlyInstallable: boolean;
}

export interface StagedPi67SkillPack {
  release: Pi67SkillPackRelease;
  stagingSuiteRoot: string;
}

export interface Pi67SkillPackChannelPort {
  check(): Promise<Pi67SkillPackRelease>;
  stage(agentDir: string): Promise<StagedPi67SkillPack>;
}

export interface Pi67SkillPackChannelOptions {
  environment?: NodeJS.ProcessEnv;
  repository?: string;
  rawRoot?: string;
  fetch?: typeof globalThis.fetch;
  runProcess?: SkillPackProcessRunner;
  createToken?: () => string;
  now?: () => number;
}

export function createPi67SkillPackChannel(
  options: Pi67SkillPackChannelOptions = {}
): Pi67SkillPackChannelPort {
  return new Pi67SkillPackChannel(options);
}

export class Pi67SkillPackChannel implements Pi67SkillPackChannelPort {
  readonly #environment: NodeJS.ProcessEnv;
  readonly #repository: string;
  readonly #rawRoot: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #runProcess: SkillPackProcessRunner;
  readonly #createToken: () => string;
  readonly #now: () => number;

  constructor(options: Pi67SkillPackChannelOptions = {}) {
    this.#environment = options.environment ?? process.env;
    this.#repository = options.repository ?? PI67_REPOSITORY;
    this.#rawRoot = (options.rawRoot ?? PI67_RAW_ROOT).replace(/\/+$/u, "");
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#runProcess = options.runProcess ?? runBoundedSkillPackProcess;
    this.#createToken = options.createToken ?? randomUUID;
    this.#now = options.now ?? Date.now;
  }

  async check(): Promise<Pi67SkillPackRelease> {
    const git = await this.#requireGit();
    const result = await this.#runProcess(git, ["ls-remote", this.#repository, "refs/heads/main"], {
      cwd: process.cwd(),
      timeoutMs: CHECK_TIMEOUT_MS,
      environment: this.#environment
    });
    const registryCommit = parseLsRemote(result.stdout);
    const [registry, lock] = await Promise.all([
      this.#readRemoteJson(`${this.#rawRoot}/${registryCommit}/${REGISTRY_PATH}`),
      this.#readRemoteJson(`${this.#rawRoot}/${registryCommit}/${LOCK_PATH}`)
    ]);
    return parseRelease(registry, lock, registryCommit);
  }

  async stage(agentDir: string): Promise<StagedPi67SkillPack> {
    const release = await this.check();
    if (!release.independentlyInstallable) {
      throw new Error("Pi-67 registry 尚未开放此 Skill Pack 的独立安装。");
    }
    if (!release.upstream) throw new Error("Pi-67 registry 缺少可安装 Skill Pack 的上游来源。");
    const git = await this.#requireGit();
    const stableRoot = managedSkillPackRoot(agentDir, release.id);
    const parent = dirname(stableRoot);
    const token = this.#createToken();
    const repositoryRoot = join(parent, `.${release.id}.${process.pid}.${token}.repository`);
    const stagingSuiteRoot = join(parent, `.${release.id}.${process.pid}.${token}.staging`);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    try {
      await this.#runGit(git, ["init", repositoryRoot], parent);
      await this.#runGit(git, ["-C", repositoryRoot, "remote", "add", "origin", this.#repository], parent);
      await this.#runGit(git, [
        "-C", repositoryRoot, "fetch", "--depth", "1", "--no-tags", "origin", release.registryCommit
      ], parent);
      await this.#runGit(git, ["-C", repositoryRoot, "checkout", "--detach", release.registryCommit], parent);
      const checkedOutCommit = (await this.#runGit(
        git,
        ["-C", repositoryRoot, "rev-parse", "HEAD"],
        parent
      )).stdout.trim();
      if (checkedOutCommit !== release.registryCommit) throw new Error("Pi-67 registry checkout commit 不匹配。");

      const checkedRegistry = JSON.parse(await readFile(join(repositoryRoot, REGISTRY_PATH), "utf8")) as unknown;
      const checkedLock = JSON.parse(await readFile(join(repositoryRoot, LOCK_PATH), "utf8")) as unknown;
      const checkedRelease = parseRelease(checkedRegistry, checkedLock, release.registryCommit);
      if (JSON.stringify(checkedRelease) !== JSON.stringify(release)) {
        throw new Error("Pi-67 registry checkout 与检查结果不一致。");
      }

      const packageRoot = join(stagingSuiteRoot, "package");
      await mkdir(join(packageRoot, "skills"), { recursive: true, mode: 0o700 });
      for (const skill of release.skills) {
        const source = join(repositoryRoot, "shared-skills", skill.name);
        const destination = join(packageRoot, "skills", skill.name);
        assertContained(source, join(repositoryRoot, "shared-skills"));
        await copyDirectory(source, destination, source);
        if (await managedPackageTreeSha256(destination) !== skill.sha256) {
          throw new Error(`Pi-67 registry Skill 完整性校验失败：${skill.name}`);
        }
      }
      const packageManifest = {
        name: "@pi67/managed-ai-berkshire-investment-suite",
        version: release.version,
        private: true,
        pi: { skills: release.skills.map((skill) => `skills/${skill.name}`) }
      };
      await writeFile(join(packageRoot, "package.json"), `${JSON.stringify(packageManifest, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
    await writeManagedSkillPackState(stagingSuiteRoot, {
        id: release.id,
        version: release.version,
        upstream: release.upstream,
        sourceCommit: release.sourceCommit,
        registryCommit: release.registryCommit,
        manifestSha256: release.manifestSha256,
        bundleSha256: release.bundleSha256,
        skills: release.skills
      }, this.#now);
      return { release, stagingSuiteRoot };
    } catch (error) {
      await rm(stagingSuiteRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async #readRemoteJson(url: string): Promise<unknown> {
    const response = await this.#fetch(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`Pi-67 registry 请求失败：HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_METADATA_BYTES) {
      throw new Error("Pi-67 registry 元数据超出大小限制。");
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > MAX_METADATA_BYTES) throw new Error("Pi-67 registry 元数据超出大小限制。");
    try {
      return JSON.parse(body.toString("utf8")) as unknown;
    } catch {
      throw new Error("Pi-67 registry 返回了无效 JSON。");
    }
  }

  async #requireGit(): Promise<string> {
    const git = this.#environment.PI67_GIT_EXECUTABLE;
    const root = this.#environment.PI67_TOOLCHAIN_ROOT;
    if (
      !git
      || !root
      || !isAbsolute(git)
      || !isAbsolute(root)
      || git.includes("\0")
      || root.includes("\0")
      || !isContainedAbsolutePath(git, root)
    ) {
      throw new Error("Pi-67 Desktop 私有 Git 工具链不可用。");
    }
    try {
      const [rootMetadata, gitMetadata, canonicalRoot, canonicalGit] = await Promise.all([
        lstat(root),
        lstat(git),
        realpath(root),
        realpath(git)
      ]);
      if (
        rootMetadata.isSymbolicLink()
        || !rootMetadata.isDirectory()
        || gitMetadata.isSymbolicLink()
        || !gitMetadata.isFile()
        || !isContainedAbsolutePath(canonicalGit, canonicalRoot)
      ) {
        throw new Error("invalid private Git executable");
      }
    } catch {
      throw new Error("Pi-67 Desktop 私有 Git 工具链不可用。");
    }
    return git;
  }

  #runGit(git: string, arguments_: string[], cwd: string) {
    return this.#runProcess(git, arguments_, {
      cwd,
      timeoutMs: UPDATE_TIMEOUT_MS,
      environment: this.#environment
    });
  }
}

export function compareSkillPackVersions(left: string, right: string): number {
  if (!VERSION_PATTERN.test(left) || !VERSION_PATTERN.test(right)) {
    throw new Error("Skill Pack version 必须使用 MAJOR.MINOR.PATCH。");
  }
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function parseRelease(registry: unknown, lock: unknown, registryCommit: string): Pi67SkillPackRelease {
  if (!COMMIT_PATTERN.test(registryCommit)) throw new Error("Pi-67 registry commit 无效。");
  if (!isRecord(registry) || registry.schema !== "pi67.shared-skill-packs.v1" || !Array.isArray(registry.packs)) {
    throw new Error("Pi-67 Skill Pack registry schema 无效。");
  }
  if (!isRecord(lock) || lock.schema !== "pi67.shared-skill-packs-lock.v1" || !Array.isArray(lock.packs)) {
    throw new Error("Pi-67 Skill Pack lock schema 无效。");
  }
  if (registry.packs.length > 64 || lock.packs.length > 64) throw new Error("Pi-67 Skill Pack registry 超出条目限制。");
  const registryMatches = registry.packs.filter((entry) => isRecord(entry) && entry.name === PACK_ID);
  const lockMatches = lock.packs.filter((entry) => isRecord(entry) && entry.name === PACK_ID);
  if (registryMatches.length !== 1 || lockMatches.length !== 1) {
    throw new Error("Pi-67 registry 缺少唯一的 AI Berkshire Skill Pack。");
  }
  const pack = registryMatches[0]!;
  const locked = lockMatches[0]!;
  const bundledReleaseOnly = pack.distribution === "bundled-release-only";
  const upstream = isHttpsUrl(pack.upstream) && pack.upstream === locked.upstream
    ? String(pack.upstream)
    : undefined;
  const legacyBundledWithoutUpstream = bundledReleaseOnly
    && pack.upstream === undefined
    && locked.upstream === "";
  if (
    !VERSION_PATTERN.test(String(pack.version ?? ""))
    || pack.version !== locked.version
    || (!upstream && !legacyBundledWithoutUpstream)
    || !COMMIT_PATTERN.test(String(locked.source_commit ?? ""))
    || !SHA256_PATTERN.test(String(locked.manifest_sha256 ?? ""))
    || !SHA256_PATTERN.test(String(locked.bundle_sha256 ?? ""))
    || (pack.distribution !== undefined && pack.distribution !== "bundled-release-only")
    || !Array.isArray(pack.skills)
    || !Array.isArray(locked.skills)
    || pack.skills.length === 0
    || pack.skills.length > 256
    || locked.skills.length !== pack.skills.length
  ) throw new Error("Pi-67 AI Berkshire Skill Pack 元数据不一致。");
  const skills: Array<{ name: string; sha256: string }> = [];
  for (let index = 0; index < pack.skills.length; index += 1) {
    const name = pack.skills[index];
    const lockedSkill = locked.skills[index];
    if (
      typeof name !== "string"
      || !SKILL_PATTERN.test(name)
      || !isRecord(lockedSkill)
      || lockedSkill.name !== name
      || typeof lockedSkill.sha256 !== "string"
      || !SHA256_PATTERN.test(lockedSkill.sha256)
    ) throw new Error("Pi-67 AI Berkshire Skill Pack 成员完整性无效。");
    skills.push({ name, sha256: lockedSkill.sha256 });
  }
  if (new Set(skills.map((skill) => skill.name)).size !== skills.length) {
    throw new Error("Pi-67 AI Berkshire Skill Pack 成员重复。");
  }
  if (hashManagedSkillSet(skills) !== locked.bundle_sha256) {
    throw new Error("Pi-67 AI Berkshire Skill Pack bundle hash 无效。");
  }
  return {
    id: PACK_ID,
    version: String(pack.version),
    ...(upstream ? { upstream } : {}),
    sourceCommit: String(locked.source_commit),
    registryCommit,
    manifestSha256: String(locked.manifest_sha256),
    bundleSha256: String(locked.bundle_sha256),
    skills,
    independentlyInstallable: !bundledReleaseOnly
  };
}

function parseLsRemote(output: string): string {
  const lines = output.split(/\r?\n/gu).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) throw new Error("Pi-67 registry branch 解析失败。");
  const [commit, ref, ...rest] = lines[0]!.split(/\s+/gu);
  if (!commit || !COMMIT_PATTERN.test(commit) || ref !== "refs/heads/main" || rest.length > 0) {
    throw new Error("Pi-67 registry branch 解析失败。");
  }
  return commit;
}

async function copyDirectory(source: string, destination: string, sourceRoot: string): Promise<void> {
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("Pi-67 registry Skill 目录无效。");
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const entries = (await readdir(source, { withFileTypes: true }))
    .filter((entry) => entry.name !== ".DS_Store" && !/\.py[cod]$/iu.test(entry.name))
    .filter((entry) => !entry.isDirectory() || !IGNORED_DIRECTORIES.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const input = join(source, entry.name);
    const output = join(destination, entry.name);
    assertContained(input, sourceRoot);
    const child = await lstat(input);
    if (child.isSymbolicLink()) throw new Error("Pi-67 registry Skill 不能包含符号链接。");
    if (child.isDirectory()) await copyDirectory(input, output, sourceRoot);
    else if (child.isFile()) await writeFile(output, await readFile(input), { mode: child.mode & 0o111 ? 0o700 : 0o600 });
    else throw new Error("Pi-67 registry Skill 包含不支持的文件类型。");
  }
}

function assertContained(candidate: string, root: string): void {
  const fromRoot = relative(resolve(root), resolve(candidate));
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new Error("Pi-67 registry Skill 路径越界。");
  }
}

function isContainedAbsolutePath(candidate: string, root: string): boolean {
  if (!isAbsolute(candidate) || !isAbsolute(root)) return false;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
