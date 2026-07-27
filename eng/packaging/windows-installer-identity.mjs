import { lstat } from "node:fs/promises";
import { dirname, join, resolve, win32 } from "node:path";
import { lt as semverLessThan, valid as validSemver } from "semver";
import {
  assertWindowsArtifactSigner,
  normalizeWindowsSignerThumbprint,
  readFileByteIdentity,
  readWindowsArtifactIdentity
} from "./windows-artifact-identity.mjs";

export function resolveWindowsInstallerPath(releaseDirectory, packageVersion) {
  if (typeof packageVersion !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(packageVersion)) {
    throw new Error(`Invalid package version for Windows installer resolution: ${String(packageVersion)}.`);
  }
  return join(releaseDirectory, `Pi-67-Desktop-${packageVersion}-win-x64.exe`);
}

export function resolveUpgradeBaselineInstaller(value, candidateVersion) {
  if (value === undefined || value === "") return undefined;
  const fileName = win32.basename(value);
  const match = /^Pi-67-Desktop-(.+)-win-x64(?:-unsigned-preview)?\.exe$/u.exec(fileName);
  const baselineVersion = match ? validSemver(match[1]) : null;
  const normalizedCandidate = validSemver(candidateVersion);
  if (!baselineVersion || !normalizedCandidate || !semverLessThan(baselineVersion, normalizedCandidate)) {
    throw new Error(`Windows upgrade baseline must be an older Pi-67 Desktop x64 installer: ${fileName}.`);
  }
  return { path: resolve(value), version: baselineVersion };
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
  const executablePath = join(installDirectory, "Pi-67 Desktop.exe");
  const executable = await lstat(executablePath);
  if (!executable.isFile() || executable.isSymbolicLink()) {
    throw new Error("Installed Pi-67 Desktop executable is not a regular file.");
  }
  return {
    arch: "x64",
    executablePath,
    platform: "win32",
    resourcesPath: join(dirname(executablePath), "resources")
  };
}
