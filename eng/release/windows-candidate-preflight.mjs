import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gt, valid } from "semver";
import {
  probeWindowsCandidateBaseline,
  readWindowsCandidateBaselineCatalog,
  resolveWindowsCandidateBaseline
} from "./windows-candidate-baseline.mjs";
import { assertWindowsPreviewCandidateIdentity, readWindowsPreviewCandidateIdentity } from "./windows-preview-candidate.mjs";

export async function preflightWindowsCandidate({
  repository,
  sourceSha,
  baseline,
  baselineIdentitySha256,
  artifactAttempt,
  catalog,
  loadCatalog = readWindowsCandidateBaselineCatalog,
  probeBaseline = probeWindowsCandidateBaseline,
  query
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository ?? "")
    || !/^[a-f0-9]{40}$/u.test(sourceSha ?? "")
    || !/^[1-9][0-9]*$/u.test(artifactAttempt ?? "")) {
    throw new Error("Expected repository owner/name, full lowercase source SHA, and positive artifact attempt.");
  }
  assertWindowsPreviewCandidateIdentity(baseline, { repository });
  if (BigInt(artifactAttempt) < BigInt(baseline.workflow.runAttempt)) {
    throw new Error("Artifact attempt cannot precede its recorded build attempt.");
  }
  const main = await query("commits/main");
  if (!/^[a-f0-9]{40}$/u.test(main?.sha ?? "")) throw new Error("Invalid remote main identity.");
  const ancestry = await query(`compare/${sourceSha}...${main.sha}`);
  if (!["ahead", "identical"].includes(ancestry?.status)) {
    throw new Error("Candidate source is not reachable from current remote main.");
  }
  const candidatePackage = await readPackage(sourceSha, query);
  const baselinePackage = await readPackage(baseline.source.commit, query);
  if (baselinePackage.version !== baseline.application.version
    || !gt(candidatePackage.version, baselinePackage.version)) {
    throw new Error("Upgrade baseline must match its source version and be older than the candidate.");
  }
  const runId = baseline.workflow.runId;
  const attempts = [...new Set([baseline.workflow.runAttempt, artifactAttempt])];
  for (const attempt of attempts) {
    const run = await query(`actions/runs/${runId}/attempts/${attempt}`);
    if (String(run?.id) !== runId || String(run?.run_attempt) !== attempt
      || run?.path !== ".github/workflows/windows-candidate.yml"
      || run?.status !== "completed"
      || (attempt === artifactAttempt && run?.conclusion !== "success")) {
      throw new Error(`Baseline run/attempt ${runId}/${attempt} is not an eligible Windows candidate.`);
    }
    const jobs = await query(`actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`);
    const required = [
      ...(attempt === baseline.workflow.runAttempt ? ["build-windows"] : []),
      ...(attempt === artifactAttempt ? ["certify-installer"] : [])
    ];
    if (!Array.isArray(jobs?.jobs) || jobs.total_count > 100
      || required.some((name) => !jobs.jobs.some((job) => job.name === name && job.conclusion === "success"))) {
      throw new Error(`Baseline attempt ${attempt} lacks successful required jobs.`);
    }
  }
  const name = `windows-candidate-${runId}-${artifactAttempt}`;
  const artifacts = await listArtifacts(runId, query);
  const matches = artifacts.filter((artifact) => artifact.name === name);
  if (matches.length > 1) {
    throw new Error("Exact baseline artifact is ambiguous.");
  }
  if (matches.length === 1 && matches[0].expired !== true && matches[0].expired !== false) {
    throw new Error("Exact baseline artifact has an invalid expiration state.");
  }
  if (matches.length === 1 && matches[0].expired === false) {
    if (!Number.isSafeInteger(matches[0].size_in_bytes) || matches[0].size_in_bytes <= 0) {
      throw new Error("Exact non-expired baseline artifact is empty or has an invalid size.");
    }
    return preflightResult({
      artifactBytes: "NOT_VERIFIED; workflow must download and verify candidate identity and hashes",
      artifactAttempt,
      baseline,
      baselineArtifact: name,
      baselineTransport: "actions-artifact",
      candidatePackage,
      main,
      sourceSha
    });
  }

  if (!/^[a-f0-9]{64}$/u.test(baselineIdentitySha256 ?? "")) {
    throw new Error("Expired or missing Actions baseline requires an exact reviewed catalog identity.");
  }
  const reviewedCatalog = catalog ?? await loadCatalog();
  if (!reviewedCatalog) {
    throw new Error("Expired or missing Actions baseline requires an exact reviewed catalog identity.");
  }
  const record = resolveWindowsCandidateBaseline(reviewedCatalog, {
    repository,
    sourceCommit: baseline.source.commit,
    runId: baseline.workflow.runId,
    runAttempt: baseline.workflow.runAttempt,
    candidateIdentitySha256: baselineIdentitySha256
  });
  const remote = await probeBaseline(record);
  return preflightResult({
    artifactBytes: `${remote.bytes} bytes; immutable origin HEAD verified, workflow must download and verify SHA-256`,
    artifactAttempt,
    baseline,
    baselineArtifact: record.publishedWindowsFileName,
    baselineIdentitySha256,
    baselinePublishedFileName: record.publishedWindowsFileName,
    baselineTransport: "immutable-update",
    candidatePackage,
    main,
    sourceSha
  });
}

function preflightResult({
  artifactBytes,
  artifactAttempt,
  baseline,
  baselineArtifact,
  baselineIdentitySha256 = "not-applicable",
  baselinePublishedFileName = "not-applicable",
  baselineTransport,
  candidatePackage,
  main,
  sourceSha
}) {
  return {
    status: "passed",
    sourceSha,
    mainSha: main.sha,
    version: candidatePackage.version,
    baselineVersion: baseline.application.version,
    baselineArtifact,
    artifactBytes,
    workflowInputs: {
      source_sha: sourceSha,
      baseline_transport: baselineTransport,
      baseline_run_id: baseline.workflow.runId,
      baseline_run_attempt: baseline.workflow.runAttempt,
      baseline_artifact_run_attempt: artifactAttempt,
      baseline_source_sha: baseline.source.commit,
      baseline_identity_sha256: baselineIdentitySha256,
      baseline_published_file_name: baselinePublishedFileName
    }
  };
}

async function readPackage(commit, query) {
  const file = await query(`contents/package.json?ref=${commit}`);
  if (file?.encoding !== "base64" || typeof file.content !== "string") throw new Error("Missing source package.json.");
  const value = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  if (value?.name !== "pi-67-desktop" || typeof value.version !== "string" || valid(value.version) !== value.version) {
    throw new Error("Invalid source package identity/version.");
  }
  return value;
}

async function listArtifacts(runId, query) {
  const artifacts = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await query(`actions/runs/${runId}/artifacts?per_page=100&page=${page}`);
    if (!Array.isArray(result?.artifacts)) throw new Error("Invalid artifact inventory.");
    artifacts.push(...result.artifacts);
    if (result.artifacts.length < 100) return artifacts;
  }
  throw new Error("Baseline artifact inventory exceeds the preflight bound.");
}

export function parsePreflightArguments(args) {
  const allowed = ["--repository", "--source-sha", "--baseline-identity", "--baseline-artifact-attempt"];
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.includes(args[index]) || values.has(args[index]) || !args[index + 1]) {
      throw new Error("Expected unique --repository, --source-sha, --baseline-identity, --baseline-artifact-attempt pairs.");
    }
    values.set(args[index], args[index + 1]);
  }
  if (values.size !== allowed.length) throw new Error("All Windows candidate preflight arguments are required.");
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parsePreflightArguments(process.argv.slice(2));
  const repository = args.get("--repository");
  const baselineIdentityPath = args.get("--baseline-identity");
  const baselineIdentity = await readBoundedIdentity(baselineIdentityPath);
  const result = await preflightWindowsCandidate({
    repository,
    sourceSha: args.get("--source-sha"),
    baseline: await readWindowsPreviewCandidateIdentity(baselineIdentityPath),
    baselineIdentitySha256: createHash("sha256").update(baselineIdentity).digest("hex"),
    artifactAttempt: args.get("--baseline-artifact-attempt"),
    query: async (endpoint) => JSON.parse(execFileSync("gh", ["api", `repos/${repository}/${endpoint}`], {
      encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024
    }))
  });
  console.log(JSON.stringify(result, null, 2));
}

async function readBoundedIdentity(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024 * 1024) {
    throw new Error("Windows candidate baseline identity is not a bounded regular file.");
  }
  return readFile(path);
}
