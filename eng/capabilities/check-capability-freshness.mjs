import { execFile as execFileCallback } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertPi67SkillPackSource } from "./pi67-skill-pack-overlay.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const lockPath = join(repositoryRoot, "eng/capabilities/capability-sources.lock.json");
const reportRelativePath = "artifacts/quality/capability-freshness.json";
const reportPath = join(repositoryRoot, reportRelativePath);
const GIT_OUTPUT_BYTES = 512 * 1024;
const REPORT_BYTES = 256 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const gitObjectPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const stableVersionPattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/u;
const stableTagPattern = /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/u;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(boundedError(error));
    process.exitCode = 1;
  }
}

export async function createCapabilityFreshnessReport({
  lock,
  now = () => new Date(),
  resolveLatest = resolveLatestStableRelease,
  resolveRef = resolveRemoteRef
}) {
  assertCapabilityLock(lock);
  const sources = await Promise.all(lock.sources.map(async (source) => {
    const base = {
      id: source.id,
      repository: source.repository,
      lockedVersion: source.version,
      lockedCommit: source.commit
    };
    try {
      const latest = await resolveLatest(source.repository);
      const comparison = compareStableVersions(source.version, latest.version);
      return {
        ...base,
        status: comparison === 0 ? "current" : comparison < 0 ? "stale" : "ahead",
        latestVersion: latest.version,
        latestTag: latest.tag,
        latestCommit: latest.commit
      };
    } catch (error) {
      return { ...base, status: "unreachable", error: boundedError(error) };
    }
  }));
  const skillPacks = await Promise.all(lock.skillPacks.map(async (pack) => {
    const base = {
      name: pack.name,
      repository: pack.repository,
      ref: pack.ref,
      lockedVersion: pack.version,
      lockedCommit: pack.commit
    };
    try {
      const latestCommit = await resolveRef(pack.repository, pack.ref);
      return {
        ...base,
        status: latestCommit === pack.commit ? "current" : "stale",
        latestCommit
      };
    } catch (error) {
      return { ...base, status: "unreachable", error: boundedError(error) };
    }
  }));
  const tracked = [...sources, ...skillPacks];
  const statuses = Object.fromEntries(
    [...new Set(tracked.map((source) => source.status))]
      .sort((left, right) => left.localeCompare(right))
      .map((status) => [status, tracked.filter((source) => source.status === status).length])
  );
  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    catalogVersion: lock.catalogVersion,
    status: tracked.every((source) => source.status === "current") ? "passed" : "failed",
    statuses,
    sources,
    skillPacks
  };
}

export async function resolveLatestStableRelease(repositoryUrl) {
  const { stdout } = await execFile(
    "git",
    ["ls-remote", "--tags", repositoryUrl],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0"
      },
      maxBuffer: GIT_OUTPUT_BYTES,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true
    }
  );
  return latestStableReleaseFromGitOutput(stdout);
}

export async function resolveRemoteRef(repositoryUrl, ref) {
  const { stdout } = await execFile(
    "git",
    ["ls-remote", repositoryUrl, ref],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0"
      },
      maxBuffer: GIT_OUTPUT_BYTES,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true
    }
  );
  return commitFromGitRefOutput(stdout, ref);
}

export function commitFromGitRefOutput(output, ref) {
  if (typeof output !== "string" || Buffer.byteLength(output) > GIT_OUTPUT_BYTES) {
    throw new Error("git ref output is invalid or exceeds the bounded limit");
  }
  const lines = output.split(/\r?\n/u).filter(Boolean);
  const matches = lines.map((line) => /^([0-9a-f]{40}|[0-9a-f]{64})\t([^\s]+)$/u.exec(line))
    .filter((match) => match?.[2] === ref);
  if (matches.length !== 1 || !gitObjectPattern.test(matches[0][1])) {
    throw new Error(`Repository ref ${ref} did not resolve to one Git commit`);
  }
  return matches[0][1];
}

export function latestStableReleaseFromGitOutput(output) {
  if (typeof output !== "string" || Buffer.byteLength(output) > GIT_OUTPUT_BYTES) {
    throw new Error("git tag output is invalid or exceeds the bounded limit");
  }
  const tags = new Map();
  for (const line of output.split(/\r?\n/u).filter(Boolean)) {
    const match = /^([0-9a-f]{40}|[0-9a-f]{64})\trefs\/tags\/([^\s^]+)(\^\{\})?$/u.exec(line);
    if (!match || !stableTagPattern.test(match[2])) continue;
    const tag = match[2];
    const version = tag.startsWith("v") ? tag.slice(1) : tag;
    const record = tags.get(tag) ?? { tag, version, objectCommit: undefined, peeledCommit: undefined };
    if (match[3]) record.peeledCommit = match[1];
    else record.objectCommit = match[1];
    tags.set(tag, record);
  }
  const releasesByVersion = new Map();
  for (const tag of tags.values()) {
    const commit = tag.peeledCommit ?? tag.objectCommit;
    if (!commit || !gitObjectPattern.test(commit)) continue;
    const existing = releasesByVersion.get(tag.version);
    if (existing && existing.commit !== commit) {
      throw new Error(`Stable tag version ${tag.version} resolves to multiple commits`);
    }
    if (!existing || tag.tag.startsWith("v")) {
      releasesByVersion.set(tag.version, { version: tag.version, tag: tag.tag, commit });
    }
  }
  const releases = [...releasesByVersion.values()];
  if (releases.length === 0) throw new Error("Repository published no supported stable semantic-version tags");
  releases.sort((left, right) => compareStableVersions(right.version, left.version));
  return releases[0];
}

export function compareStableVersions(left, right) {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

async function runCli(argumentsList) {
  const options = parseArguments(argumentsList);
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const report = await createCapabilityFreshnessReport({ lock });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > REPORT_BYTES) throw new Error("Capability freshness report is too large");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, serialized, "utf8");
  const summary = renderSummary(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
  process.stdout.write(options.json ? serialized : summary);
  console.error(`Wrote capability freshness report to ${reportRelativePath}.`);
  if (report.status !== "passed") process.exitCode = 1;
}

function parseArguments(argumentsList) {
  const options = { json: false };
  for (const argument of argumentsList) {
    if (argument === "--") continue;
    if (argument === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function assertCapabilityLock(lock) {
  if (
    !isRecord(lock)
    || lock.schema !== "pi67.capability-sources-lock.v1"
    || typeof lock.catalogVersion !== "string"
    || lock.catalogVersion.length === 0
    || lock.catalogVersion.length > 100
    || !Array.isArray(lock.sources)
    || lock.sources.length === 0
    || lock.sources.length > 32
    || !Array.isArray(lock.skillPacks)
    || lock.skillPacks.length === 0
    || lock.skillPacks.length > 8
  ) throw new Error("Capability source lock is invalid");
  const ids = new Set();
  for (const source of lock.sources) {
    if (
      !isRecord(source)
      || typeof source.id !== "string"
      || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(source.id)
      || ids.has(source.id)
      || typeof source.repository !== "string"
      || source.repository.length === 0
      || source.repository.length > 4_096
      || !gitObjectPattern.test(source.commit)
    ) throw new Error("Capability source lock entry is invalid");
    parseStableVersion(source.version);
    const repository = new URL(source.repository);
    if (repository.protocol !== "https:") throw new Error("Capability source repository must use HTTPS");
    ids.add(source.id);
  }
  const packNames = new Set();
  for (const pack of lock.skillPacks) {
    assertPi67SkillPackSource(pack);
    if (packNames.has(pack.name)) throw new Error("Bundled Skill Pack source is duplicated");
    packNames.add(pack.name);
  }
}

function parseStableVersion(value) {
  if (typeof value !== "string") throw new Error("Capability version must be a stable semantic version");
  const match = stableVersionPattern.exec(value);
  if (!match) throw new Error(`Unsupported stable semantic version: ${value}`);
  return match.slice(1).map(Number);
}

function renderSummary(report) {
  const lines = [
    "## First-party capability freshness",
    "",
    `Catalog: ${report.catalogVersion}`,
    `Result: ${report.status}`,
    "",
    "| Source | Locked | Latest stable | Status | Release commit |",
    "| --- | --- | --- | --- | --- |"
  ];
  for (const source of report.sources) {
    lines.push([
      escapeTable(source.id),
      escapeTable(source.lockedVersion),
      escapeTable(source.latestVersion ?? source.error ?? "unknown"),
      source.status,
      source.latestCommit?.slice(0, 12) ?? "unknown"
    ].join(" | ").replace(/^/u, "| ").replace(/$/u, " |"));
  }
  lines.push(
    "",
    "## Bundled Skill Pack freshness",
    "",
    "| Skill Pack | Locked baseline | Tracked ref | Status | Latest commit |",
    "| --- | --- | --- | --- | --- |"
  );
  for (const pack of report.skillPacks) {
    lines.push([
      escapeTable(pack.name),
      escapeTable(pack.lockedVersion),
      escapeTable(pack.ref),
      pack.status,
      pack.latestCommit?.slice(0, 12) ?? "unknown"
    ].join(" | ").replace(/^/u, "| ").replace(/$/u, " |"));
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ").slice(0, 320);
}

function boundedError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/gu, " ").slice(0, 500);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
