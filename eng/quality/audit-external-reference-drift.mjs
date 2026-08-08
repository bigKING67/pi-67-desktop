import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPiRuntimeContract } from "../release/pi-runtime-contract.mjs";
import { checkExternalReferenceGovernance } from "./check-external-references.mjs";

const execFile = promisify(execFileCallback);
const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
const reportRelativePath = "artifacts/quality/external-reference-drift.json";
const maximumReportBytes = 1_048_576;
const maximumLicenseBytes = 262_144;
const gitObjectPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function createExternalReferenceAudit({
  catalog,
  reviewLock,
  selectedRepositories,
  installedPiVersion,
  now = () => new Date(),
  readLicense = readRemoteLicense,
  readPiLatest = readPiRegistryLatest,
  resolveRemote = resolveRemoteHead
}) {
  const repositories = await Promise.all(selectedRepositories.map((repository) => auditRepository({
    installedPiVersion,
    readLicense,
    readPiLatest,
    repository,
    resolveRemote,
    review: reviewLock.reviews[repository.id]
  })));
  const statuses = Object.fromEntries(
    [...new Set(repositories.map((repository) => repository.status))]
      .sort((left, right) => left.localeCompare(right))
      .map((status) => [status, repositories.filter((repository) => repository.status === status).length])
  );
  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    catalogSchemaVersion: catalog.schemaVersion,
    statuses,
    repositories
  };
}

async function runCli(argumentsList) {
  const options = parseArguments(argumentsList);
  const { catalog, reviewLock } = await checkExternalReferenceGovernance(defaultRoot);
  const selectedRepositories = selectRepositories(catalog.repositories, options);
  const { runtimeVersion } = await readPiRuntimeContract(defaultRoot);
  const report = await createExternalReferenceAudit({
    catalog,
    installedPiVersion: runtimeVersion,
    reviewLock,
    selectedRepositories
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > maximumReportBytes) {
    throw new Error(`External reference audit exceeds ${maximumReportBytes} bytes`);
  }
  const reportPath = join(defaultRoot, reportRelativePath);
  await mkdir(join(defaultRoot, "artifacts/quality"), { recursive: true });
  await writeFile(reportPath, serialized, "utf8");

  const summary = renderSummary(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
  if (options.json) process.stdout.write(serialized);
  else process.stdout.write(summary);
  console.error(`Wrote bounded external reference audit to ${reportRelativePath}.`);
}

async function auditRepository({
  installedPiVersion,
  readLicense,
  readPiLatest,
  repository,
  resolveRemote,
  review
}) {
  const base = {
    id: repository.id,
    url: repository.url,
    tier: repository.tier,
    reviewState: repository.reviewState
  };
  try {
    const remote = await resolveRemote(repository.url);
    if (repository.reviewState === "contract-managed") {
      const latestVersion = await readPiLatest();
      return {
        ...base,
        status: latestVersion === installedPiVersion ? "current" : "drifted",
        defaultBranch: remote.defaultBranch,
        remoteHead: remote.head,
        installedVersion: installedPiVersion,
        registryLatestVersion: latestVersion
      };
    }
    if (!review) {
      return {
        ...base,
        status: "unreviewed",
        defaultBranch: remote.defaultBranch,
        remoteHead: remote.head
      };
    }

    const currentLicenseHash = await readLicense(repository.url, remote.head, review.license.path);
    const licenseChanged = currentLicenseHash !== review.license.sha256;
    const headChanged = remote.head !== review.reviewedCommit || remote.defaultBranch !== review.sourceRef;
    return {
      ...base,
      status: licenseChanged ? "license-changed" : headChanged ? "drifted" : "current",
      defaultBranch: remote.defaultBranch,
      remoteHead: remote.head,
      reviewedCommit: review.reviewedCommit,
      reviewRange: headChanged ? `${review.reviewedCommit}..${remote.head}` : undefined,
      license: {
        path: review.license.path,
        reviewedSha256: review.license.sha256,
        remoteSha256: currentLicenseHash
      }
    };
  } catch (error) {
    return {
      ...base,
      status: "unreachable",
      error: boundedError(error)
    };
  }
}

export async function resolveRemoteHead(repositoryUrl) {
  const { stdout } = await execFile(
    "git",
    ["ls-remote", "--symref", repositoryUrl, "HEAD"],
    { encoding: "utf8", maxBuffer: 65_536, timeout: 20_000 }
  );
  const lines = stdout.split(/\r?\n/u).filter(Boolean);
  const symref = lines.map((line) => /^ref:\s+refs\/heads\/(.+)\tHEAD$/u.exec(line)).find(Boolean);
  const headLine = lines.map((line) => /^([0-9a-f]{40}|[0-9a-f]{64})\tHEAD$/u.exec(line)).find(Boolean);
  if (!symref || !headLine || !gitObjectPattern.test(headLine[1])) {
    throw new Error("git ls-remote did not return a bounded default branch and full HEAD object ID");
  }
  return { defaultBranch: symref[1], head: headLine[1] };
}

export async function readPiRegistryLatest() {
  const { stdout } = await execFile(
    "npm",
    ["view", "@earendil-works/pi-coding-agent", "version", "--json"],
    { encoding: "utf8", maxBuffer: 65_536, timeout: 20_000 }
  );
  const value = JSON.parse(stdout);
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new Error("npm registry returned an invalid Pi package version");
  }
  return value;
}

export async function readRemoteLicense(repositoryUrl, commit, licensePath) {
  if (!gitObjectPattern.test(commit)) throw new Error("Remote license lookup requires a full Git object ID");
  const url = new URL(repositoryUrl);
  const [owner, repository] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repository) throw new Error("Remote license lookup requires a canonical GitHub URL");
  const encodedPath = licensePath.split("/").map(encodeURIComponent).join("/");
  const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${commit}/${encodedPath}`;
  const response = await fetch(rawUrl, {
    headers: { "user-agent": "pi-67-desktop-reference-audit" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Remote license request failed with HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maximumLicenseBytes) throw new Error("Remote license exceeds the byte limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maximumLicenseBytes) {
    throw new Error("Remote license is empty or exceeds the byte limit");
  }
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArguments(argumentsList) {
  const options = { all: false, id: undefined, json: false, tier: undefined };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--") continue;
    if (argument === "--all") options.all = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--id") options.id = requiredValue(argumentsList, ++index, "--id");
    else if (argument === "--tier") options.tier = requiredValue(argumentsList, ++index, "--tier");
    else throw new Error(`Unknown argument: ${argument}`);
  }
  const selectors = Number(options.all) + Number(Boolean(options.id)) + Number(Boolean(options.tier));
  if (selectors !== 1) throw new Error("Choose exactly one selector: --id <id>, --tier <S0-S1>, or --all");
  if (options.tier && !/^S[01]$/u.test(options.tier)) throw new Error(`Unsupported tier: ${String(options.tier)}`);
  return options;
}

function selectRepositories(repositories, options) {
  const selected = options.all
    ? repositories
    : options.id
      ? repositories.filter((repository) => repository.id === options.id)
      : repositories.filter((repository) => repository.tier === options.tier);
  if (selected.length === 0) throw new Error("The external reference selector matched no repositories");
  return selected;
}

function renderSummary(report) {
  const lines = [
    "## External reference drift audit",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "| Repository | Tier | Review state | Status | Remote |",
    "| --- | --- | --- | --- | --- |"
  ];
  for (const repository of report.repositories) {
    const remote = repository.remoteHead ? repository.remoteHead.slice(0, 12) : repository.error ?? "unknown";
    lines.push(
      `| ${escapeTable(repository.id)} | ${repository.tier} | ${repository.reviewState} | ${repository.status} | ${escapeTable(remote)} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ").slice(0, 320);
}

function requiredValue(argumentsList, index, flag) {
  const value = argumentsList[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function boundedError(error) {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/[\r\n]+/gu, " ").slice(0, 300);
}
