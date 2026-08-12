import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { WINDOWS_INSTALLER_PROCESS_TIMEOUT_MS } from "./windows-installer-lifecycle-contract.mjs";

const FILE_STATE_TIMEOUT_MS = 30_000;

export function buildNsisInstallArguments(installDirectory) {
  if (typeof installDirectory !== "string" || installDirectory.length === 0) {
    throw new Error("NSIS install directory must be a non-empty single-line path.");
  }
  const hasControlCharacter = installDirectory.includes("\r")
    || installDirectory.includes("\n")
    || installDirectory.includes("\u0000");
  if (hasControlCharacter) {
    throw new Error("NSIS install directory must be a non-empty single-line path.");
  }
  return ["/S", `/D=${installDirectory}`];
}

export async function installNsisPackage(installerPath, installDirectory) {
  await runExecutable(installerPath, buildNsisInstallArguments(installDirectory));
  await waitForPathState(join(installDirectory, "Pi-67 Desktop.exe"), true);
}

export async function resolveUninstallerPath(installDirectory) {
  const matches = (await readdir(installDirectory))
    .filter((name) => /^Uninstall.*\.exe$/iu.test(name));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one NSIS uninstaller, found ${matches.length}.`);
  }
  return join(installDirectory, matches[0]);
}

export async function cleanupWindowsInstallation(installDirectory) {
  if (!(await pathExists(installDirectory))) return;
  const matches = (await readdir(installDirectory).catch(() => []))
    .filter((name) => /^Uninstall.*\.exe$/iu.test(name));
  if (matches.length === 1) {
    await runExecutable(join(installDirectory, matches[0]), ["/S"]);
    await waitForInstallationRemoval(installDirectory);
  }
}

export function runExecutable(executablePath, argumentsList) {
  return new Promise((resolvePromise, reject) => {
    execFile(executablePath, argumentsList, {
      encoding: "utf8",
      maxBuffer: 256 * 1024,
      timeout: WINDOWS_INSTALLER_PROCESS_TIMEOUT_MS,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = [stdout, stderr].filter(Boolean).join("\n").slice(0, 4_096);
        const termination = [
          `timeoutMs=${WINDOWS_INSTALLER_PROCESS_TIMEOUT_MS}`,
          `killed=${String(error.killed ?? false)}`,
          `code=${String(error.code ?? "none")}`,
          `signal=${String(error.signal ?? "none")}`
        ].join(", ");
        reject(new Error(
          `${basename(executablePath)} failed (${termination}): ${error.message}${detail ? `\n${detail}` : ""}`
        ));
        return;
      }
      resolvePromise();
    });
  });
}

export async function waitForPathState(path, shouldExist, timeoutMs = FILE_STATE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exists = await pathExists(path);
    if (exists === shouldExist) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for ${path} to become ${shouldExist ? "present" : "absent"}.`);
}

export async function waitForInstallationRemoval(installDirectory) {
  const deadline = Date.now() + FILE_STATE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await pathExists(installDirectory))) return;
    const remaining = await readdir(installDirectory).catch(() => []);
    if (remaining.length === 0) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  const remaining = await readdir(installDirectory).catch(() => []);
  throw new Error(`NSIS uninstall left files in the install directory: ${remaining.slice(0, 20).join(", ")}.`);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
