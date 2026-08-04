import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  verifySourceRunJobsMetadata,
  verifySourceRunMetadata,
  windowsInstallerCandidateName
} from "./windows-installer-source-run.mjs";

const MAX_SOURCE_RUN_CANDIDATES = 10;
const GITHUB_QUERY_TIMEOUT_MS = 30_000;

export async function resolveWindowsInstallerReuseSource({
  listArtifacts,
  listJobs,
  runs,
  sourceSha
}) {
  const candidates = runs
    .filter((run) => isPotentialSourceRun(run, sourceSha))
    .sort((left, right) => runTimestamp(right) - runTimestamp(left))
    .slice(0, MAX_SOURCE_RUN_CANDIDATES);

  for (const run of candidates) {
    try {
      verifySourceRunMetadata(run, sourceSha);
      verifySourceRunJobsMetadata(await listJobs(run.id));
      const artifactName = windowsInstallerCandidateName(run.id);
      const artifacts = await listArtifacts(run.id);
      const matchingArtifacts = artifacts.filter((candidate) => (
        candidate?.name === artifactName
        && candidate.expired === false
        && Number.isSafeInteger(candidate.size_in_bytes)
        && candidate.size_in_bytes > 0
      ));
      if (matchingArtifacts.length !== 1) continue;
      return {
        available: true,
        artifactName,
        reason: "reusable-failed-lifecycle-run",
        sourceRunId: String(run.id),
        sourceSha
      };
    } catch {
      // A newer failed run may be unrelated; continue to the next exact-SHA candidate.
    }
  }

  return {
    available: false,
    artifactName: "",
    reason: candidates.length === 0
      ? "no-completed-failed-ci-run"
      : "no-reusable-installer-lifecycle-candidate",
    sourceRunId: "",
    sourceSha: ""
  };
}

function isPotentialSourceRun(run, sourceSha) {
  return Number.isSafeInteger(run?.id)
    && run.id > 0
    && run.head_sha === sourceSha
    && run.status === "completed"
    && run.conclusion === "failure"
    && run.path === ".github/workflows/ci.yml"
    && run.run_attempt === 1;
}

function runTimestamp(run) {
  const value = Date.parse(run?.updated_at ?? run?.created_at ?? "");
  return Number.isFinite(value) ? value : 0;
}

function queryGithubJson(repository, endpoint, fields = {}) {
  const args = ["api", "--method", "GET", `repos/${repository}/${endpoint}`];
  for (const [name, value] of Object.entries(fields)) args.push("-f", `${name}=${value}`);
  return JSON.parse(execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1_048_576,
    timeout: GITHUB_QUERY_TIMEOUT_MS
  }));
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Expected --base, --repository, and --github-output arguments.");
    }
    values.set(name, value);
  }
  const sourceSha = values.get("--base");
  const repository = values.get("--repository");
  const githubOutput = values.get("--github-output");
  if (!sourceSha || !repository || !githubOutput || values.size !== 3) {
    throw new Error("Expected exactly --base, --repository, and --github-output arguments.");
  }
  if (!/^[a-f0-9]{40}$/iu.test(sourceSha) || /^0+$/u.test(sourceSha)) {
    throw new Error("Windows installer reuse base must be a full non-zero commit ID.");
  }
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/iu.test(repository)) {
    throw new Error("GitHub repository must use owner/name syntax.");
  }
  return { sourceSha, repository, githubOutput };
}

async function writeGithubOutput(path, result) {
  await appendFile(resolve(path), [
    `reuse_available=${String(result.available)}`,
    `source_run_id=${result.sourceRunId}`,
    `source_sha=${result.sourceSha}`,
    `artifact_name=${result.artifactName}`,
    `reuse_reason=${result.reason}`,
    ""
  ].join("\n"), "utf8");
}

async function main() {
  const { sourceSha, repository, githubOutput } = parseArguments(process.argv.slice(2));
  let result;
  try {
    const response = queryGithubJson(repository, "actions/runs", {
      head_sha: sourceSha,
      status: "completed",
      per_page: 100
    });
    result = await resolveWindowsInstallerReuseSource({
      sourceSha,
      runs: Array.isArray(response?.workflow_runs) ? response.workflow_runs : [],
      listArtifacts: async (runId) => {
        const artifacts = queryGithubJson(repository, `actions/runs/${runId}/artifacts`, { per_page: 100 });
        return Array.isArray(artifacts?.artifacts) ? artifacts.artifacts : [];
      },
      listJobs: async (runId) => queryGithubJson(repository, `actions/runs/${runId}/jobs`, {
        filter: "latest",
        per_page: 100
      })
    });
  } catch (error) {
    console.warn(`Windows installer reuse lookup failed closed: ${error instanceof Error ? error.message : "unknown error"}`);
    result = {
      available: false,
      artifactName: "",
      reason: "github-query-failed",
      sourceRunId: "",
      sourceSha: ""
    };
  }

  await writeGithubOutput(githubOutput, result);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
