import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertWindowsPreviewCandidateIdentity } from "./windows-preview-candidate.mjs";
import { assertWindowsPreviewManualTestReceipt } from "./windows-preview-promotion.mjs";
import { R2_UPDATE_ORIGIN } from "./r2-update-release-contract.mjs";
import { validateUnsignedPreviewManifest } from "./unsigned-preview-artifacts.mjs";
import { verifyUnsignedPreviewBaseline } from "./verify-unsigned-preview-baseline.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const defaultCatalogPath = join(repositoryRoot, "eng/release/windows-candidate-baselines.json");
const defaultOutputDirectory = join(repositoryRoot, "artifacts/baseline/release");
const CATALOG_SCHEMA = "pi67.windows-candidate-baselines.v1";
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_CATALOG_RECORDS = 16;
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const FULL_COMMIT = /^[a-f0-9]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

export async function readWindowsCandidateBaselineCatalog(path = defaultCatalogPath) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_CATALOG_BYTES) {
    throw new Error("Windows candidate baseline catalog is not a bounded regular file.");
  }
  const catalog = JSON.parse(await readFile(path, "utf8"));
  if (catalog?.schema !== CATALOG_SCHEMA
    || !Array.isArray(catalog.records)
    || catalog.records.length < 1
    || catalog.records.length > MAX_CATALOG_RECORDS) {
    throw new Error("Windows candidate baseline catalog identity or record count is invalid.");
  }

  const identities = new Set();
  const records = catalog.records.map((record) => validateCatalogRecord(record));
  for (const record of records) {
    const key = [
      record.candidateIdentity.repository,
      record.candidateIdentity.source.commit,
      record.candidateIdentity.workflow.runId,
      record.candidateIdentity.workflow.runAttempt
    ].join(":");
    if (identities.has(key)) throw new Error("Windows candidate baseline catalog contains a duplicate record.");
    identities.add(key);
  }
  return { schema: catalog.schema, records };
}

export function validateCatalogRecord(record) {
  for (const [label, value] of [
    ["candidate identity", record?.candidateIdentitySha256],
    ["manual test receipt", record?.manualTestReceiptSha256],
    ["unsigned preview manifest", record?.unsignedPreviewManifestSha256]
  ]) {
    if (!SHA256.test(value ?? "")) throw new Error(`Windows candidate baseline ${label} SHA-256 is invalid.`);
  }
  if (typeof record?.publishedWindowsFileName !== "string"
    || basename(record.publishedWindowsFileName) !== record.publishedWindowsFileName
    || !record.publishedWindowsFileName.endsWith("-win-x64-unsigned-preview.exe")) {
    throw new Error("Windows candidate baseline published filename is invalid.");
  }

  const candidate = assertWindowsPreviewCandidateIdentity(record.candidateIdentity);
  assertCanonicalHash(record.candidateIdentity, record.candidateIdentitySha256, "candidate identity");
  assertCanonicalHash(record.manualTestReceipt, record.manualTestReceiptSha256, "manual test receipt");
  assertCanonicalHash(record.unsignedPreviewManifest, record.unsignedPreviewManifestSha256, "unsigned preview manifest");

  const receipt = assertWindowsPreviewManualTestReceipt(record.manualTestReceipt, {
    candidateIdentitySha256: record.candidateIdentitySha256,
    candidateCertificationRunAttempt: record.manualTestReceipt?.candidate?.certificationRunAttempt,
    candidateRunAttempt: candidate.workflow.runAttempt,
    candidateRunId: candidate.workflow.runId,
    repository: candidate.repository,
    sourceCommit: candidate.source.commit
  });
  if (receipt.candidate.installerSha256 !== candidate.installer.sha256
    || receipt.candidate.packagedExecutableSha256 !== candidate.packagedExecutable.sha256) {
    throw new Error("Windows candidate baseline manual test hashes do not match its candidate identity.");
  }

  const runtimeMatch = /^@earendil-works\/pi-coding-agent@(.+)$/u.exec(candidate.application.runtime);
  const manifestFailures = runtimeMatch
    ? validateUnsignedPreviewManifest(
      record.unsignedPreviewManifest,
      candidate.application.version,
      runtimeMatch[1]
    )
    : ["invalid candidate runtime identity"];
  if (manifestFailures.length > 0) {
    throw new Error(`Windows candidate baseline manifest is invalid:\n${manifestFailures.map((item) => `- ${item}`).join("\n")}`);
  }
  const windowsEntries = record.unsignedPreviewManifest.files
    .filter((entry) => entry.target === "windows-x64");
  if (windowsEntries.length !== 1
    || windowsEntries[0].name !== record.publishedWindowsFileName
    || windowsEntries[0].bytes !== candidate.installer.byteLength
    || windowsEntries[0].sha256 !== candidate.installer.sha256) {
    throw new Error("Windows candidate baseline published artifact does not match its candidate identity.");
  }
  return record;
}

export function resolveWindowsCandidateBaseline(catalog, expected) {
  if (!REPOSITORY.test(expected?.repository ?? "")
    || !FULL_COMMIT.test(expected?.sourceCommit ?? "")
    || !POSITIVE_INTEGER.test(expected?.runId ?? "")
    || !POSITIVE_INTEGER.test(expected?.runAttempt ?? "")
    || !SHA256.test(expected?.candidateIdentitySha256 ?? "")
    || (expected?.publishedWindowsFileName !== undefined
      && typeof expected.publishedWindowsFileName !== "string")) {
    throw new Error("Exact Windows candidate baseline identity is incomplete or invalid.");
  }
  const matches = catalog.records.filter((record) => {
    const candidate = record.candidateIdentity;
    return candidate.repository === expected.repository
      && candidate.source.commit === expected.sourceCommit
      && candidate.workflow.runId === expected.runId
      && candidate.workflow.runAttempt === expected.runAttempt
      && record.candidateIdentitySha256 === expected.candidateIdentitySha256
      && (expected.publishedWindowsFileName === undefined
        || record.publishedWindowsFileName === expected.publishedWindowsFileName);
  });
  if (matches.length !== 1) {
    throw new Error("Exact Windows candidate baseline is missing or ambiguous in the reviewed catalog.");
  }
  return matches[0];
}

export async function probeWindowsCandidateBaseline(record, fetchImpl = fetch) {
  const entry = windowsManifestEntry(record);
  const url = publishedArtifactUrl(record.publishedWindowsFileName);
  const response = await fetchImpl(url, { method: "HEAD", redirect: "manual" });
  assertImmutableResponse(response, url, entry.bytes);
  return { bytes: entry.bytes, sha256: entry.sha256, url };
}

export async function restoreWindowsCandidateBaseline({
  catalog,
  expected,
  fetchImpl = fetch,
  outputDirectory = defaultOutputDirectory
}) {
  const record = resolveWindowsCandidateBaseline(catalog, expected);
  const entry = windowsManifestEntry(record);
  if (entry.bytes > MAX_INSTALLER_BYTES) throw new Error("Windows candidate baseline exceeds the download boundary.");
  const url = publishedArtifactUrl(record.publishedWindowsFileName);
  const existing = await lstat(outputDirectory).catch(() => null);
  if (existing) throw new Error("Windows candidate baseline output directory must not already exist.");

  await mkdir(dirname(outputDirectory), { recursive: true });
  const stagingDirectory = await mkdtemp(join(dirname(outputDirectory), ".windows-candidate-baseline-"));
  let installed = false;
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "manual" });
    assertImmutableResponse(response, url, entry.bytes);
    if (!response.body) throw new Error("Windows candidate baseline response has no body.");

    const installerPath = join(stagingDirectory, record.publishedWindowsFileName);
    const verifier = createDownloadVerifier(entry.bytes, entry.sha256);
    await pipeline(
      Readable.fromWeb(response.body),
      verifier.stream,
      createWriteStream(installerPath, { flags: "wx", mode: 0o600 })
    );
    verifier.assertComplete();

    await Promise.all([
      writeCanonicalJson(join(stagingDirectory, "windows-preview-candidate-identity.json"), record.candidateIdentity),
      writeCanonicalJson(join(stagingDirectory, "windows-preview-manual-test.json"), record.manualTestReceipt),
      writeCanonicalJson(join(stagingDirectory, "unsigned-preview-manifest.json"), record.unsignedPreviewManifest),
      writeFile(
        join(stagingDirectory, "SHA256SUMS.txt"),
        `${entry.sha256}  ${record.publishedWindowsFileName}\n`,
        { encoding: "utf8", mode: 0o600 }
      )
    ]);
    await verifyUnsignedPreviewBaseline(stagingDirectory, `v${record.candidateIdentity.application.version}`);
    await rename(stagingDirectory, outputDirectory);
    installed = true;
    const result = await verifyUnsignedPreviewBaseline(
      outputDirectory,
      `v${record.candidateIdentity.application.version}`
    );
    return { ...result, record, url };
  } catch (error) {
    await rm(installed ? outputDirectory : stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertCanonicalHash(value, expected, label) {
  const actual = createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
  if (actual !== expected) throw new Error(`Windows candidate baseline ${label} hash mismatch.`);
}

function windowsManifestEntry(record) {
  return record.unsignedPreviewManifest.files.find((entry) => entry.target === "windows-x64");
}

function publishedArtifactUrl(fileName) {
  return new URL(encodeURIComponent(fileName), `${R2_UPDATE_ORIGIN}/`).href;
}

function assertImmutableResponse(response, expectedUrl, expectedBytes) {
  if (response?.status !== 200) {
    throw new Error(`Windows candidate baseline origin returned HTTP ${String(response?.status)}.`);
  }
  if (response.redirected === true || (typeof response.url === "string" && response.url !== expectedUrl)) {
    throw new Error("Windows candidate baseline origin redirected away from the exact immutable URL.");
  }
  const contentLength = response.headers?.get?.("content-length");
  if (!/^[1-9][0-9]*$/u.test(contentLength ?? "") || Number(contentLength) !== expectedBytes) {
    throw new Error("Windows candidate baseline origin content length mismatch.");
  }
}

function createDownloadVerifier(expectedBytes, expectedSha256) {
  let bytes = 0;
  const hash = createHash("sha256");
  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > expectedBytes || bytes > MAX_INSTALLER_BYTES) {
        callback(new Error("Windows candidate baseline download exceeded its exact size boundary."));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  return {
    stream,
    assertComplete() {
      if (bytes !== expectedBytes) throw new Error("Windows candidate baseline download size mismatch.");
      if (hash.digest("hex") !== expectedSha256) {
        throw new Error("Windows candidate baseline download SHA-256 mismatch.");
      }
    }
  };
}

async function writeCanonicalJson(path, value) {
  await writeFile(path, canonicalJsonBytes(value), { mode: 0o600 });
}

function parseRestoreArguments(args) {
  const allowed = new Set([
    "--repository",
    "--source-sha",
    "--run-id",
    "--run-attempt",
    "--candidate-identity-sha256",
    "--published-file-name"
  ]);
  if (args.length !== allowed.size * 2) throw new Error("All Windows candidate baseline restore arguments are required.");
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || values.has(args[index]) || !args[index + 1]) {
      throw new Error("Windows candidate baseline restore arguments must be unique name/value pairs.");
    }
    values.set(args[index], args[index + 1]);
  }
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseRestoreArguments(process.argv.slice(2));
  const catalog = await readWindowsCandidateBaselineCatalog();
  const result = await restoreWindowsCandidateBaseline({
    catalog,
    expected: {
      repository: args.get("--repository"),
      sourceCommit: args.get("--source-sha"),
      runId: args.get("--run-id"),
      runAttempt: args.get("--run-attempt"),
      candidateIdentitySha256: args.get("--candidate-identity-sha256"),
      publishedWindowsFileName: args.get("--published-file-name")
    }
  });
  console.log(`Restored exact Windows upgrade baseline ${result.record.candidateIdentity.application.version}.`);
  if (process.env.GITHUB_ENV) {
    if (result.installerPath.includes("\r") || result.installerPath.includes("\n")) {
      throw new Error("Windows candidate baseline path cannot be written to GITHUB_ENV.");
    }
    await appendFile(process.env.GITHUB_ENV, `PI67_WINDOWS_BASELINE_INSTALLER=${result.installerPath}\n`, "utf8");
  }
}
