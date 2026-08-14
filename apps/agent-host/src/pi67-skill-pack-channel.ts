import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { gitSourceCandidates } from "@pi67/domain";
import {
  managedPackageTreeSha256,
  managedSkillPackRoot,
  writeManagedSkillPackState
} from "./managed-skill-pack-state.js";
import {
  runBoundedSkillPackProcess,
  type SkillPackProcessRunner
} from "./skill-pack-process-runner.js";
import {
  isolatedGitEnvironment,
  loadPackageNetworkSettings
} from "./package-network-settings.js";
import {
  parsePi67RegistryBranch,
  parsePi67SkillPackRelease,
  type Pi67SkillPackRelease
} from "./pi67-skill-pack-registry.js";

export { compareSkillPackVersions } from "./pi67-skill-pack-registry.js";
export type { Pi67SkillPackRelease } from "./pi67-skill-pack-registry.js";

const PI67_REPOSITORY = "https://github.com/bigKING67/pi-67.git";
const REGISTRY_PATH = "shared-skill-packs.json";
const LOCK_PATH = "shared-skill-packs.lock.json";
const MAX_METADATA_BYTES = 512 * 1024;
const CHECK_TIMEOUT_MS = 60_000;
const UPDATE_TIMEOUT_MS = 5 * 60_000;
const IGNORED_DIRECTORIES = new Set(["__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"]);

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
  readonly #runProcess: SkillPackProcessRunner;
  readonly #createToken: () => string;
  readonly #now: () => number;

  constructor(options: Pi67SkillPackChannelOptions = {}) {
    this.#environment = options.environment ?? process.env;
    this.#repository = options.repository ?? PI67_REPOSITORY;
    this.#runProcess = options.runProcess ?? runBoundedSkillPackProcess;
    this.#createToken = options.createToken ?? randomUUID;
    this.#now = options.now ?? Date.now;
  }

  async check(): Promise<Pi67SkillPackRelease> {
    return (await this.#resolveRemote()).release;
  }

  async stage(agentDir: string): Promise<StagedPi67SkillPack> {
    const resolved = await this.#resolveRemote();
    const { release } = resolved;
    if (!release.independentlyInstallable) {
      throw new Error("Pi-67 registry 尚未开放此 Skill Pack 的独立安装。");
    }
    if (!release.upstream) throw new Error("Pi-67 registry 缺少可安装 Skill Pack 的上游来源。");
    const git = await this.#requireGit();
    const stableRoot = managedSkillPackRoot(agentDir, release.id);
    const parent = dirname(stableRoot);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const failures: string[] = [];
    for (const transport of resolved.transports) {
      const token = this.#createToken();
      const repositoryRoot = join(parent, `.${release.id}.${process.pid}.${token}.repository`);
      const stagingSuiteRoot = join(parent, `.${release.id}.${process.pid}.${token}.staging`);
      try {
        await this.#runGit(git, ["init", repositoryRoot], parent);
        await this.#runGit(git, ["-C", repositoryRoot, "remote", "add", "origin", transport.transportUrl], parent);
        try {
          await this.#runGit(git, [
            "-C", repositoryRoot, "fetch", "--depth", "1", "--no-tags", "origin", release.registryCommit
          ], parent);
        } catch (error) {
          throw sourceTransportFailure(error);
        }
        await this.#runGit(git, ["-C", repositoryRoot, "checkout", "--detach", release.registryCommit], parent);
        const checkedOutCommit = (await this.#runGit(
          git,
          ["-C", repositoryRoot, "rev-parse", "HEAD"],
          parent
        )).stdout.trim();
        if (checkedOutCommit !== release.registryCommit) {
          throw integrityFailure("Pi-67 registry checkout commit 不匹配。");
        }

        const [checkedRegistry, checkedLock] = await Promise.all([
          readBoundedJson(join(repositoryRoot, REGISTRY_PATH)),
          readBoundedJson(join(repositoryRoot, LOCK_PATH))
        ]);
        const checkedRelease = parsePi67SkillPackRelease(checkedRegistry, checkedLock, release.registryCommit);
        if (JSON.stringify(checkedRelease) !== JSON.stringify(release)) {
          throw integrityFailure("Pi-67 registry checkout 与检查结果不一致。");
        }

        const packageRoot = join(stagingSuiteRoot, "package");
        await mkdir(join(packageRoot, "skills"), { recursive: true, mode: 0o700 });
        for (const skill of release.skills) {
          const source = join(repositoryRoot, "shared-skills", skill.name);
          const destination = join(packageRoot, "skills", skill.name);
          assertContained(source, join(repositoryRoot, "shared-skills"));
          await copyDirectory(source, destination, source);
          if (await managedPackageTreeSha256(destination) !== skill.sha256) {
            throw integrityFailure(`Pi-67 registry Skill 完整性校验失败：${skill.name}`);
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
        if (!isSourceTransportFailure(error)) throw error;
        failures.push(`${transport.id}: ${boundedSourceFailure(error)}`);
      } finally {
        await rm(repositoryRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    throw new Error(`Pi-67 registry 下载源均不可用（${failures.join("；").slice(0, 800)}）。`);
  }

  async #resolveRemote(): Promise<{
    release: Pi67SkillPackRelease;
    transports: Array<{ id: string; transportUrl: string }>;
  }> {
    const git = await this.#requireGit();
    const settings = await loadPackageNetworkSettings(this.#environment.PI67_PACKAGE_NETWORK_SETTINGS);
    const candidates = gitSourceCandidates(settings, this.#repository);
    if (candidates.length === 0) throw new Error("当前网络设置为离线模式，无法检查 Skill Pack 更新。");
    const failures: string[] = [];
    for (const [index, candidate] of candidates.entries()) {
      let branchOutput: string;
      try {
        const result = await this.#runGit(
          git,
          ["ls-remote", candidate.transportUrl, "refs/heads/main"],
          process.cwd(),
          CHECK_TIMEOUT_MS
        );
        branchOutput = result.stdout;
      } catch (error) {
        failures.push(`${candidate.id}: ${boundedSourceFailure(error)}`);
        continue;
      }
      let registryCommit: string;
      try {
        registryCommit = parsePi67RegistryBranch(branchOutput);
      } catch (error) {
        throw integrityFailure(error instanceof Error ? error.message : "Pi-67 registry branch 解析失败。");
      }
      try {
        const release = await this.#readReleaseThroughGit(git, candidate.transportUrl, registryCommit);
        return {
          release,
          transports: candidates.slice(index).map((transport) => ({
            id: transport.id,
            transportUrl: transport.transportUrl
          }))
        };
      } catch (error) {
        if (!isSourceTransportFailure(error)) throw error;
        failures.push(`${candidate.id}: ${boundedSourceFailure(error)}`);
      }
    }
    throw new Error(`Pi-67 registry 下载源均不可用（${failures.join("；").slice(0, 800)}）。`);
  }

  async #readReleaseThroughGit(
    git: string,
    transportUrl: string,
    registryCommit: string
  ): Promise<Pi67SkillPackRelease> {
    const repositoryRoot = join(tmpdir(), `pi67-skill-pack-check-${process.pid}-${this.#createToken()}`);
    await mkdir(repositoryRoot, { recursive: false, mode: 0o700 });
    try {
      await this.#runGit(git, ["init", repositoryRoot], tmpdir(), CHECK_TIMEOUT_MS);
      await this.#runGit(
        git,
        ["-C", repositoryRoot, "remote", "add", "origin", transportUrl],
        tmpdir(),
        CHECK_TIMEOUT_MS
      );
      try {
        await this.#runGit(git, [
          "-C", repositoryRoot, "fetch", "--depth", "1", "--no-tags", "origin", registryCommit
        ], tmpdir(), CHECK_TIMEOUT_MS);
      } catch (error) {
        throw sourceTransportFailure(error);
      }
      const fetchedCommit = (await this.#runGit(
        git,
        ["-C", repositoryRoot, "rev-parse", "FETCH_HEAD"],
        tmpdir(),
        CHECK_TIMEOUT_MS
      )).stdout.trim();
      if (fetchedCommit !== registryCommit) throw integrityFailure("Pi-67 registry fetch commit 不匹配。");
      try {
        await this.#runGit(git, [
          "-C", repositoryRoot, "checkout", registryCommit, "--", REGISTRY_PATH, LOCK_PATH
        ], tmpdir(), CHECK_TIMEOUT_MS);
      } catch (error) {
        throw integrityFailure(error instanceof Error ? error.message : "Pi-67 registry 元数据 checkout 失败。");
      }
      const [registry, lock] = await Promise.all([
        readBoundedJson(join(repositoryRoot, REGISTRY_PATH)),
        readBoundedJson(join(repositoryRoot, LOCK_PATH))
      ]);
      try {
        return parsePi67SkillPackRelease(registry, lock, registryCommit);
      } catch (error) {
        throw integrityFailure(error instanceof Error ? error.message : "Pi-67 registry 元数据无效。");
      }
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true }).catch(() => undefined);
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

  #runGit(git: string, arguments_: string[], cwd: string, timeoutMs = UPDATE_TIMEOUT_MS) {
    return this.#runProcess(git, arguments_, {
      cwd,
      timeoutMs,
      environment: isolatedGitEnvironment(this.#environment)
    });
  }
}

async function readBoundedJson(path: string): Promise<unknown> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    throw integrityFailure("Pi-67 registry 元数据缺失或不可读。");
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_METADATA_BYTES) {
    throw integrityFailure("Pi-67 registry 元数据超出大小限制。");
  }
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw integrityFailure("Pi-67 registry 返回了无效 JSON。");
  }
}

function sourceTransportFailure(cause: unknown): Error & { sourceTransportFailure: true } {
  return Object.assign(new Error(boundedSourceFailure(cause), { cause }), {
    sourceTransportFailure: true as const
  });
}

function isSourceTransportFailure(error: unknown): error is Error & { sourceTransportFailure: true } {
  return error instanceof Error
    && "sourceTransportFailure" in error
    && error.sourceTransportFailure === true;
}

function integrityFailure(message: string): Error & { registryIntegrityFailure: true } {
  return Object.assign(new Error(message), { registryIntegrityFailure: true as const });
}

function boundedSourceFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 180)
    || "unavailable";
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
