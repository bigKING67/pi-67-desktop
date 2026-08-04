import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import * as systemPath from "node:path";
import { lt as semverLessThan, valid as validSemver } from "semver";
import {
  assertWindowsArtifactSigner,
  normalizeWindowsSignerThumbprint,
  readFileByteIdentity,
  readWindowsArtifactIdentity
} from "./windows-artifact-identity.mjs";

export function createSessionCreationDiagnostic(
  observation,
  existingIdentities = [],
  existingSessionFileNames = []
) {
  const newSessionIdentities = observation?.newSessionIdentities ?? [];
  const newSessionFileNames = newSessionIdentities
    .map(readDiagnosticSessionFileName)
    .filter((value) => value !== null);
  return {
    distinctNewSessionFileNameCount: new Set(newSessionFileNames).size,
    errorNotificationCount: observation?.errorNotificationCount ?? 0,
    errorNotificationTitles: observation?.errorNotificationTitles ?? [],
    knownIdentityFingerprints: fingerprintSessionIdentities(existingIdentities),
    knownSessionFileNameCount: existingSessionFileNames.length,
    newSessionFileNames,
    newSessionIdentityFingerprints: fingerprintSessionIdentities(newSessionIdentities),
    newSessionRowCount: observation?.newSessionRowCount ?? 0,
    provisionalRowCount: observation?.provisionalRowCount ?? 0,
    rowCount: observation?.rowCount ?? 0,
    runtimePhase: observation?.runtimePhase ?? null,
    runtimeStatus: observation?.runtimeStatus ?? null,
    selectedIdentityFingerprint: fingerprintSessionIdentity(observation?.selectedIdentity),
    selectedNewSession: observation?.selectedNewSession ?? false,
    selectedProvisional: observation?.selectedProvisional ?? false,
    sessionIdentityFingerprints: fingerprintSessionIdentities(observation?.sessionIdentities ?? []),
    sessionRowCount: observation?.sessionRowCount ?? 0,
    unrecognizedNewSessionFileNameCount: newSessionIdentities.length - newSessionFileNames.length
  };
}

export function sessionPathFromIdentity(identity, agentDir, pathApi = systemPath) {
  const match = /^session:[^:]+:(.+)$/u.exec(identity);
  if (!match) throw new Error("Windows real-user Session identity is malformed.");
  const sessionPath = pathApi.resolve(match[1]);
  assertSessionPathContained(agentDir, sessionPath, pathApi);
  return sessionPath;
}

export function assertSessionPathContained(agentDir, sessionPath, pathApi = systemPath) {
  const relativePath = pathApi.relative(
    comparablePath(agentDir, pathApi),
    comparablePath(sessionPath, pathApi)
  );
  if (pathApi.isAbsolute(relativePath) || /^\.\.(?:[\\/]|$)/u.test(relativePath)) {
    throw new Error("Windows real-user Session JSONL resolved outside the isolated Agent directory.");
  }
}

function comparablePath(value, pathApi) {
  const resolved = pathApi.resolve(value);
  if (pathApi.sep !== "\\") return resolved;
  const extendedPrefix = "\\\\?\\";
  const extendedUncPrefix = `${extendedPrefix}UNC\\`;
  if (resolved.toUpperCase().startsWith(extendedUncPrefix.toUpperCase())) {
    return `\\\\${resolved.slice(extendedUncPrefix.length)}`;
  }
  const unprefixed = resolved.startsWith(extendedPrefix)
    ? resolved.slice(extendedPrefix.length)
    : resolved;
  return /^[a-z]:[\\/]/iu.test(unprefixed) ? unprefixed : resolved;
}

function fingerprintSessionIdentities(identities) {
  return identities.slice(0, 8).map(fingerprintSessionIdentity);
}

function fingerprintSessionIdentity(identity) {
  if (typeof identity !== "string" || identity.length === 0) return null;
  return createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 12);
}

function readDiagnosticSessionFileName(identity) {
  if (typeof identity !== "string") return null;
  const separatorIndex = Math.max(identity.lastIndexOf("/"), identity.lastIndexOf("\\"), identity.lastIndexOf(":"));
  const candidate = identity.slice(separatorIndex + 1);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.jsonl$/u.test(candidate) ? candidate : null;
}

export function resolveWindowsInstallerPath(releaseDirectory, packageVersion) {
  if (typeof packageVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(packageVersion)) {
    throw new Error(`Invalid package version for Windows installer resolution: ${String(packageVersion)}.`);
  }
  return systemPath.join(releaseDirectory, `Pi-67-Desktop-${packageVersion}-win-x64.exe`);
}

export function resolveUpgradeBaselineInstaller(value, candidateVersion) {
  if (value === undefined || value === "") return undefined;
  const fileName = systemPath.win32.basename(value);
  const match = /^Pi-67-Desktop-(.+)-win-x64(?:-unsigned-preview)?\.exe$/u.exec(fileName);
  const baselineVersion = match ? validSemver(match[1]) : null;
  const normalizedCandidate = validSemver(candidateVersion);
  if (!baselineVersion || !normalizedCandidate || !semverLessThan(baselineVersion, normalizedCandidate)) {
    throw new Error(`Windows upgrade baseline must be an older Pi-67 Desktop x64 installer: ${fileName}.`);
  }
  return { path: systemPath.resolve(value), version: baselineVersion };
}

export function resolveExpectedLifecycleSigner(value) {
  if (value === undefined || value === "") return undefined;
  return normalizeWindowsSignerThumbprint(value);
}

export async function readLifecycleArtifactIdentity(path, expectedSigner, label) {
  if (!expectedSigner) return readFileByteIdentity(path);
  return assertWindowsArtifactSigner(await readWindowsArtifactIdentity(path), expectedSigner, label);
}

export async function resolveInstalledArtifact(installDirectory) {
  const executablePath = systemPath.join(installDirectory, "Pi-67 Desktop.exe");
  const executable = await lstat(executablePath);
  if (!executable.isFile() || executable.isSymbolicLink()) {
    throw new Error("Installed Pi-67 Desktop executable is not a regular file.");
  }
  return {
    arch: "x64",
    executablePath,
    platform: "win32",
    resourcesPath: systemPath.join(systemPath.dirname(executablePath), "resources")
  };
}
