import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  changedPathsBetween,
  normalizeRepoPath
} from "./classify-change-scope.mjs";
import {
  verifySourceRunJobsMetadata,
  verifySourceRunMetadata
} from "./windows-installer-source-run.mjs";
import { verifyWindowsInstallerVerifierScope } from "./windows-installer-verifier-scope.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export { verifySourceRunJobsMetadata, verifySourceRunMetadata };

export function verifyWindowsInstallerDebugScope(paths) {
  verifyWindowsInstallerVerifierScope(paths.map(normalizeRepoPath));
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error("Invalid debug scope arguments.");
    values.set(name, value);
  }
  const base = values.get("--base");
  const head = values.get("--head");
  const runMetadata = values.get("--run-metadata");
  const jobsMetadata = values.get("--jobs-metadata");
  if (!base || !head || !runMetadata || !jobsMetadata || values.size !== 4) {
    throw new Error("Expected exactly --base, --head, --run-metadata, and --jobs-metadata.");
  }
  return { base, head, runMetadata, jobsMetadata };
}

async function main() {
  const { base, head, runMetadata, jobsMetadata } = parseArguments(process.argv.slice(2));
  if (!/^[a-f0-9]{40}$/iu.test(base) || !/^[a-f0-9]{40}$/iu.test(head)) {
    throw new Error("Debug source and verifier refs must resolve to full Git commit IDs.");
  }
  const metadata = JSON.parse(await readFile(resolve(runMetadata), "utf8"));
  const jobs = JSON.parse(await readFile(resolve(jobsMetadata), "utf8"));
  verifySourceRunMetadata(metadata, base);
  verifySourceRunJobsMetadata(jobs);
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", base, head], {
      cwd: repositoryRoot,
      stdio: "ignore"
    });
  } catch {
    throw new Error("The debug verifier ref must descend from the artifact source SHA.");
  }
  const paths = changedPathsBetween(base, head, repositoryRoot);
  if (paths === undefined) throw new Error("Unable to resolve the debug verifier diff.");
  verifyWindowsInstallerDebugScope(paths);
  console.log(JSON.stringify({ sourceSha: base, verifierSha: head, changedPathCount: paths.length }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
