import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, win32 } from "node:path";
import { valid as validSemver } from "semver";
import { normalizeWindowsSignerThumbprint } from "../packaging/windows-artifact-identity.mjs";
import { parseCanonicalStableTag } from "./release-manifest-contract.mjs";

export const WINDOWS_SIGNED_CANDIDATE_SCHEMA = "pi67.windows-signed-candidate.v2";
export const WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY = Object.freeze({
  stable: "stable",
  versionTag: "version-tag"
});

const MAX_IDENTITY_BYTES = 64 * 1024;

export async function readWindowsSignedCandidateIdentity(path, expected = {}) {
  return (await readHashedWindowsSignedCandidateIdentity(path, expected)).identity;
}

export async function readHashedWindowsSignedCandidateIdentity(path, expected = {}) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_IDENTITY_BYTES) {
    throw new Error("Windows signed candidate identity exceeds its file boundary.");
  }
  let source;
  let value;
  try {
    source = await readFile(path);
    value = JSON.parse(source.toString("utf8"));
  } catch {
    throw new Error("Windows signed candidate identity is not valid JSON.");
  }
  assertWindowsSignedCandidateIdentity(value, expected);
  return {
    identity: value,
    identitySha256: createHash("sha256").update(source).digest("hex")
  };
}

export function assertWindowsSignedCandidateIdentity(value, expected = {}) {
  if (!isRecord(value) || value.schema !== WINDOWS_SIGNED_CANDIDATE_SCHEMA) {
    throw new Error("Windows signed candidate identity schema is invalid.");
  }
  requireRepository(value.repository);
  requireDigits(value.workflow?.runId, "workflow.runId");
  requireDigits(value.workflow?.runAttempt, "workflow.runAttempt");
  const sourcePolicy = expected.sourcePolicy ?? WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY.stable;
  requireSourcePolicy(sourcePolicy);
  if (value.source?.policy !== sourcePolicy) {
    throw new Error("Windows signed candidate source policy does not match the active authority.");
  }
  const sourceVersion = parseSourceTag(value.source?.tag, sourcePolicy);
  requireHash(value.source?.commit, 40, "source.commit", true);
  if (value.application?.product !== "Pi-67 Desktop"
    || value.application?.version !== sourceVersion
    || value.application?.platform !== "win32"
    || value.application?.architecture !== "x64") {
    throw new Error("Windows signed candidate application identity is invalid.");
  }
  requireRuntime(value.application.runtime);
  assertSignedFileIdentity(value.installer, "installer", false);
  assertSignedFileIdentity(value.packagedExecutable, "packagedExecutable", true);
  if (basename(value.installer.fileName) !== value.installer.fileName
    || win32.basename(value.installer.fileName) !== value.installer.fileName) {
    throw new Error("Windows signed candidate installer.fileName must be a basename.");
  }
  if (value.packagedExecutable.fileName !== "win-unpacked/Pi-67 Desktop.exe") {
    throw new Error("Windows signed candidate packagedExecutable.fileName is invalid.");
  }
  if (value.installer.authenticode.signerThumbprint
    !== value.packagedExecutable.authenticode.signerThumbprint) {
    throw new Error("Windows signed candidate installer and executable signer identities differ.");
  }
  assertExpected(value.repository, expected.repository, "repository");
  assertExpected(value.source.tag, expected.sourceTag, "source.tag");
  assertExpected(value.source.commit, expected.sourceCommit, "source.commit");
  assertExpected(value.workflow.runId, expected.runId, "workflow.runId");
  assertExpected(value.workflow.runAttempt, expected.runAttempt, "workflow.runAttempt");
  assertExpected(value.application.version, expected.version, "application.version");
  assertExpected(
    value.packagedExecutable.sha256,
    expected.packagedExecutableSha256,
    "packagedExecutable.sha256"
  );
  if (expected.expectedSignerThumbprint !== undefined) {
    const expectedSigner = normalizeWindowsSignerThumbprint(expected.expectedSignerThumbprint);
    if (value.installer.authenticode.signerThumbprint !== expectedSigner) {
      throw new Error("Windows signed candidate Publisher does not match the active authority.");
    }
  }
}

export async function hashWindowsSignedCandidateIdentity(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function parseSourceTag(value, sourcePolicy) {
  if (sourcePolicy === WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY.stable) {
    return parseCanonicalStableTag(value, "candidate source tag");
  }
  if (typeof value !== "string" || !value.startsWith("v")) {
    throw new Error(`Invalid canonical candidate source tag: ${String(value)}.`);
  }
  const version = value.slice(1);
  if (version.includes("+") || validSemver(version) !== version) {
    throw new Error(`Invalid canonical candidate source tag: ${String(value)}.`);
  }
  return version;
}

function requireSourcePolicy(value) {
  if (!Object.values(WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY).includes(value)) {
    throw new Error(`Unsupported Windows signed candidate source policy: ${String(value)}.`);
  }
}

function assertSignedFileIdentity(value, label, requireRelativePath) {
  if (!isRecord(value)) throw new Error(`Windows signed candidate ${label} identity is missing.`);
  requireBoundedString(value.fileName, `${label}.fileName`, 512);
  if (requireRelativePath && (value.fileName.startsWith("/") || /^[A-Za-z]:/u.test(value.fileName))) {
    throw new Error(`Windows signed candidate ${label}.fileName must be relative.`);
  }
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 1) {
    throw new Error(`Windows signed candidate ${label}.byteLength is invalid.`);
  }
  requireHash(value.sha256, 64, `${label}.sha256`, true);
  if (value.authenticode?.status !== "Valid") {
    throw new Error(`Windows signed candidate ${label} Authenticode status is invalid.`);
  }
  requireHash(value.authenticode.signerThumbprint, 40, `${label}.signerThumbprint`, false);
  requireBoundedString(value.authenticode.signerSubject, `${label}.signerSubject`, 1_024);
}

function requireRuntime(value) {
  if (typeof value !== "string"
    || !/^@earendil-works\/pi-coding-agent@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new Error("Windows signed candidate Pi runtime identity is invalid.");
  }
}

function requireRepository(value) {
  if (typeof value !== "string"
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(value)) {
    throw new Error("Windows signed candidate repository identity is invalid.");
  }
}

function requireDigits(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`Windows signed candidate ${label} is invalid.`);
  }
}

function requireBoundedString(value, label, limit) {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > limit
    || value.includes("\r")
    || value.includes("\n")
    || value.includes("\u0000")) {
    throw new Error(`Windows signed candidate ${label} is invalid.`);
  }
}

function requireHash(value, length, label, lowercase) {
  const pattern = lowercase
    ? new RegExp(`^[0-9a-f]{${length}}$`, "u")
    : new RegExp(`^[0-9A-F]{${length}}$`, "u");
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`Windows signed candidate ${label} is invalid.`);
  }
}

function assertExpected(actual, expected, label) {
  if (expected !== undefined && actual !== expected) {
    throw new Error(`Windows signed candidate ${label} does not match the active authority.`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
