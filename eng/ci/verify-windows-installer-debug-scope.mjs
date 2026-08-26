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
  verifySourceRunMetadata,
  verifyWindowsCandidateSourceRunJobsMetadata,
  verifyWindowsCandidateSourceRunMetadata
} from "./windows-installer-source-run.mjs";
import { verifyWindowsInstallerVerifierScope } from "./windows-installer-verifier-scope.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export {
  verifySourceRunJobsMetadata,
  verifySourceRunMetadata,
  verifyWindowsCandidateSourceRunJobsMetadata,
  verifyWindowsCandidateSourceRunMetadata
};

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
  const sourceKind = values.get("--source-kind");
  const sourceRunAttemptValue = values.get("--source-run-attempt");
  if (
    !base
    || !head
    || !runMetadata
    || !jobsMetadata
    || !["candidate", "ci"].includes(sourceKind)
    || !/^\d+$/u.test(sourceRunAttemptValue ?? "")
    || values.size !== 6
  ) {
    throw new Error(
      "Expected exactly --base, --head, --run-metadata, --jobs-metadata, --source-kind, and --source-run-attempt."
    );
  }
  const sourceRunAttempt = Number.parseInt(sourceRunAttemptValue, 10);
  if (!Number.isSafeInteger(sourceRunAttempt) || sourceRunAttempt <= 0) {
    throw new Error("Source run attempt must be a positive integer.");
  }
  return { base, head, jobsMetadata, runMetadata, sourceKind, sourceRunAttempt };
}

async function main() {
  const {
    base,
    head,
    jobsMetadata,
    runMetadata,
    sourceKind,
    sourceRunAttempt
  } = parseArguments(process.argv.slice(2));
  if (!/^[a-f0-9]{40}$/iu.test(base) || !/^[a-f0-9]{40}$/iu.test(head)) {
    throw new Error("Debug source and verifier refs must resolve to full Git commit IDs.");
  }
  const metadata = JSON.parse(await readFile(resolve(runMetadata), "utf8"));
  const jobs = JSON.parse(await readFile(resolve(jobsMetadata), "utf8"));
  if (sourceKind === "candidate") {
    verifyWindowsCandidateSourceRunMetadata(metadata, base, sourceRunAttempt);
    verifyWindowsCandidateSourceRunJobsMetadata(jobs);
  } else {
    verifySourceRunMetadata(metadata, base);
    verifySourceRunJobsMetadata(jobs, { allowPackagedUiFailure: true });
  }
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
  console.log(JSON.stringify({
    changedPathCount: paths.length,
    sourceKind,
    sourceSha: base,
    verifierSha: head
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
