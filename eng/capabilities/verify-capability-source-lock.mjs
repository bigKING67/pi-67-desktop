import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertCapabilitySourceLock } from "./prepared-capabilities-validation.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const lockPath = join(repositoryRoot, "eng/capabilities/capability-sources.lock.json");
const GIT_TIMEOUT_MS = 60_000;
const GIT_OUTPUT_BYTES = 16_384;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const json = process.argv.slice(2).includes("--json");
    const unknown = process.argv.slice(2).filter((argument) => argument !== "--json");
    if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    const result = await verifyCapabilitySourceLock({ lock });
    process.stdout.write(json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `Verified ${result.sources.length} remotely fetchable capability source commits.\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function verifyCapabilitySourceLock({ lock, verifyCommit = fetchExactCommit }) {
  assertCapabilitySourceLock(lock);
  const sources = [
    ...lock.sources.filter((source) => source.repository !== undefined).map((source) => ({
      id: source.id,
      repository: source.repository,
      commit: source.commit
    })),
    ...lock.skillPacks.map((source) => ({
      id: `skill-pack:${source.name}`,
      repository: source.repository,
      commit: source.commit
    }))
  ];
  await Promise.all(sources.map(async (source) => {
    try {
      await verifyCommit(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Locked capability source ${source.id} is not remotely fetchable at ${source.commit}: ${message}`);
    }
  }));
  return {
    schema: "pi67.capability-source-reachability.v1",
    sources
  };
}

async function fetchExactCommit(source) {
  const root = await mkdtemp(join(tmpdir(), "pi67-capability-source-"));
  const options = {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never"
    },
    maxBuffer: GIT_OUTPUT_BYTES,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true
  };
  try {
    await execFile("git", ["init", "--bare", root], options);
    await execFile(
      "git",
      ["--git-dir", root, "fetch", "--depth", "1", "--no-tags", source.repository, source.commit],
      options
    );
    const { stdout } = await execFile("git", ["--git-dir", root, "rev-parse", "FETCH_HEAD"], options);
    if (stdout.trim() !== source.commit) throw new Error("fetched commit did not match the lock");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
