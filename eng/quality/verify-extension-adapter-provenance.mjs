import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_EXTENSION_ADAPTER_CONFORMANCE } from "../../packages/extension-compat/dist/index.mjs";
import {
  EXTENSION_ADAPTER_PROVENANCE_LIMITS,
  verifyExtensionAdapterPublishedArtifacts,
  verifyRegistryMetadata
} from "./extension-adapter-provenance.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const reportPath = join(root, "artifacts/quality/extension-adapter-provenance.json");
const registry = new URL("https://registry.npmjs.org/");
const FETCH_TIMEOUT_MS = 20_000;
const GIT_TIMEOUT_MS = 60_000;
const COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;

const temporaryRoot = await mkdtemp(join(tmpdir(), "pi67-extension-provenance-"));
const gitGlobalConfig = join(temporaryRoot, "empty-gitconfig");
const repositoryCache = new Map();
const reports = [];
await writeFile(gitGlobalConfig, "", "utf8");

try {
  for (const record of BUILTIN_EXTENSION_ADAPTER_CONFORMANCE.records) {
    const startedAt = Date.now();
    try {
      const metadata = await fetchRegistryMetadata(record.evidence);
      const tarballUrl = verifyRegistryMetadata(record.evidence, metadata);
      const tarballBytes = await fetchBoundedBytes(
        tarballUrl,
        EXTENSION_ADAPTER_PROVENANCE_LIMITS.compressedBytes,
        "npm tarball"
      );
      const repository = await sourceRepository(record.evidence);
      const verified = await verifyExtensionAdapterPublishedArtifacts(record, {
        metadata,
        tarballBytes,
        readRepositoryFile: repository.readFile
      });
      reports.push({
        status: "passed",
        durationMs: Date.now() - startedAt,
        ...verified
      });
      console.log(`Verified ${record.evidence.package}@${record.evidence.installedVersion}.`);
    } catch (error) {
      reports.push({
        status: "failed",
        adapterId: record.evidence.adapterId,
        package: record.evidence.package,
        installedVersion: record.evidence.installedVersion,
        sourceRepository: record.evidence.sourceRepository,
        sourceCommit: record.evidence.sourceCommit,
        durationMs: Date.now() - startedAt,
        error: boundedErrorMessage(error)
      });
      console.error(`Failed ${record.evidence.package}@${record.evidence.installedVersion}: ${boundedErrorMessage(error)}`);
    }
  }

  const failed = reports.filter((report) => report.status === "failed");
  await writeReport(failed.length === 0 ? "passed" : "failed");
  if (failed.length > 0) {
    throw new Error(`Extension Adapter provenance failed for ${failed.length} of ${reports.length} record(s)`);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function fetchRegistryMetadata(evidence) {
  const packagePath = `${encodeURIComponent(evidence.package)}/${encodeURIComponent(evidence.installedVersion)}`;
  const bytes = await fetchBoundedBytes(
    new URL(packagePath, registry),
    EXTENSION_ADAPTER_PROVENANCE_LIMITS.metadataBytes,
    "npm metadata"
  );
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`npm metadata is not valid UTF-8 JSON for ${evidence.package}@${evidence.installedVersion}`);
  }
}

async function fetchBoundedBytes(url, limit, label) {
  const response = await fetch(url, {
    headers: { accept: label === "npm metadata" ? "application/json" : "application/octet-stream" },
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new Error(`${label} declares ${contentLength} bytes, exceeding ${limit}`);
  }
  if (!response.body) throw new Error(`${label} response has no body`);

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > limit) throw new Error(`${label} exceeds ${limit} bytes`);
    chunks.push(Buffer.from(chunk));
  }
  if (total === 0) throw new Error(`${label} response is empty`);
  return Buffer.concat(chunks, total);
}

async function sourceRepository(evidence) {
  const key = `${evidence.sourceRepository}#${evidence.sourceCommit}`;
  let repository = repositoryCache.get(key);
  if (!repository) {
    repository = prepareRepository(evidence, repositoryCache.size + 1);
    repositoryCache.set(key, repository);
  }
  return repository;
}

async function prepareRepository(evidence, index) {
  const directory = join(temporaryRoot, `repository-${index}`);
  await mkdir(directory);
  await runGit(["init", "--quiet", directory]);
  await runGit(["-C", directory, "remote", "add", "origin", evidence.sourceRepository]);
  await runGit([
    "-C", directory,
    "fetch", "--quiet", "--depth=1", "--filter=blob:none", "--no-tags", "origin", evidence.sourceCommit
  ]);
  await runGit(["-C", directory, "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  const resolved = (await runGit(["-C", directory, "rev-parse", "HEAD"])).stdout.toString("utf8").trim();
  if (resolved !== evidence.sourceCommit) throw new Error("Git checkout did not resolve to the pinned source commit");

  return Object.freeze({
    readFile: async (path) => readGitBlob(directory, path)
  });
}

async function readGitBlob(repositoryDirectory, path) {
  const object = `HEAD:${path}`;
  const probe = await runGit(
    ["-C", repositoryDirectory, "cat-file", "-e", object],
    { allowedExitCodes: new Set([0, 128]) }
  );
  if (probe.exitCode !== 0) return undefined;
  const result = await runGit(
    ["-C", repositoryDirectory, "show", object],
    { stdoutBytes: EXTENSION_ADAPTER_PROVENANCE_LIMITS.sourceBytes }
  );
  return result.stdout;
}

function runGit(args, options = {}) {
  return runBoundedCommand("git", args, {
    ...options,
    timeoutMs: GIT_TIMEOUT_MS,
    stderrBytes: COMMAND_OUTPUT_BYTES,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: gitGlobalConfig,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0"
    }
  });
}

function runBoundedCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputFailure;
    const timeout = setTimeout(() => {
      outputFailure = `${command} exceeded ${options.timeoutMs}ms`;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > (options.stdoutBytes ?? COMMAND_OUTPUT_BYTES)) {
        outputFailure = `${command} stdout exceeded its bounded output limit`;
        child.kill("SIGKILL");
      } else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > options.stderrBytes) {
        outputFailure = `${command} stderr exceeded its bounded output limit`;
        child.kill("SIGKILL");
      } else stderr.push(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      if (outputFailure) return reject(new Error(outputFailure));
      const code = exitCode ?? -1;
      if (!(options.allowedExitCodes ?? new Set([0])).has(code)) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        return reject(new Error(`${command} exited with ${code}${detail ? `: ${detail}` : ""}`));
      }
      resolve({ exitCode: code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

async function writeReport(status) {
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    nodeVersion: process.version,
    records: reports
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wrote bounded provenance report to ${reportPath}.`);
}

function boundedErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(temporaryRoot, "<temporary-repository>").slice(0, 2_000);
}
