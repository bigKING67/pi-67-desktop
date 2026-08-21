import { execFileSync, spawnSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedVersionTag } from "./verify-version-tag.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const FULL_COMMIT = /^[a-f0-9]{40}$/u;

export async function verifyPreviewCandidateSource({
  mainReference = "origin/main",
  root = repositoryRoot,
  sourceCommit
}) {
  if (!FULL_COMMIT.test(sourceCommit ?? "")) {
    throw new Error("Preview candidate source must be a full lowercase Git commit SHA.");
  }
  const head = git(root, ["rev-parse", "HEAD"]);
  if (head !== sourceCommit) {
    throw new Error(`Preview candidate checkout ${head} does not match requested source ${sourceCommit}.`);
  }
  const mainCommit = git(root, ["rev-parse", mainReference]);
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", sourceCommit, mainReference], {
    cwd: root,
    encoding: "utf8"
  });
  if (ancestor.error) throw ancestor.error;
  if (ancestor.status !== 0) {
    throw new Error(`Preview candidate source ${sourceCommit} is not reachable from ${mainReference}.`);
  }
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const tag = expectedVersionTag(packageJson.version);
  return { mainCommit, sourceCommit, tag, version: packageJson.version };
}

export async function verifyR2PublicationSource({
  mainReference = "origin/main",
  root = repositoryRoot,
  sourceCommit
}) {
  if (!FULL_COMMIT.test(sourceCommit ?? "")) {
    throw new Error("R2 artifact source must be a full lowercase Git commit SHA.");
  }
  const releaseToolCommit = git(root, ["rev-parse", "HEAD"]);
  const mainCommit = git(root, ["rev-parse", mainReference]);
  if (releaseToolCommit !== mainCommit) {
    throw new Error(`R2 release tooling checkout ${releaseToolCommit} does not match ${mainReference} ${mainCommit}.`);
  }
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", sourceCommit, releaseToolCommit], {
    cwd: root,
    encoding: "utf8"
  });
  if (ancestor.error) throw ancestor.error;
  if (ancestor.status !== 0) {
    throw new Error(`R2 artifact source ${sourceCommit} is not an ancestor of release tooling ${releaseToolCommit}.`);
  }
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  return {
    mainCommit,
    releaseToolCommit,
    sourceCommit,
    tag: expectedVersionTag(packageJson.version),
    version: packageJson.version
  };
}

export function assertCleanPreviewCandidateSource({ root = repositoryRoot } = {}) {
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.length > 0) {
    throw new Error("R2 publication requires a clean exact-SHA source checkout.");
  }
}

function git(cwd, arguments_) {
  return execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
}

function parseArguments(argumentsList) {
  if (argumentsList.length % 2 !== 0) throw new Error("Preview candidate source arguments are incomplete.");
  const allowed = new Set(["--github-output", "--main-reference", "--source-commit"]);
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    if (!allowed.has(name) || values.has(name)) {
      throw new Error(`Invalid preview candidate source argument: ${name}.`);
    }
    values.set(name, argumentsList[index + 1]);
  }
  return values;
}

function requiredArgument(values, name) {
  const value = values.get(name);
  if (typeof value !== "string"
    || value.length === 0
    || value.includes("\r")
    || value.includes("\n")
    || value.includes("\u0000")) {
    throw new Error(`${name} requires a non-empty single-line value.`);
  }
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = parseArguments(process.argv.slice(2));
  const result = await verifyPreviewCandidateSource({
    mainReference: values.get("--main-reference") ?? "origin/main",
    sourceCommit: requiredArgument(values, "--source-commit")
  });
  const githubOutput = values.get("--github-output");
  if (githubOutput) {
    await appendFile(
      githubOutput,
      `source_commit=${result.sourceCommit}\nversion=${result.version}\ntag=${result.tag}\n`,
      "utf8"
    );
  }
  console.log(`Verified preview candidate source ${result.sourceCommit} on main for ${result.tag}.`);
}
