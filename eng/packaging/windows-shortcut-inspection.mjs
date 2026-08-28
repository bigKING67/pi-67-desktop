import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  realpath,
  writeFile
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const POWERSHELL_TIMEOUT_MS = 15_000;
const execFileAsync = promisify(execFile);

export async function resolveWindowsDesktopShortcutPath(shortcutName) {
  if (process.platform !== "win32") {
    throw new Error("Windows Desktop shortcut resolution requires win32.");
  }
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Console]::Out.Write([Environment]::GetFolderPath('Desktop'))"
  ], { encoding: "utf8", timeout: POWERSHELL_TIMEOUT_MS });
  const desktopPath = stdout.trim();
  if (desktopPath.length === 0) throw new Error("Windows Desktop path is unavailable.");
  return join(desktopPath, `${shortcutName}.lnk`);
}

export async function assertWindowsShortcutTarget(shortcutPath, executablePath, options = {}) {
  await access(shortcutPath);
  const inspection = options.evidenceDirectory
    ? await inspectWindowsShortcutTarget(shortcutPath, options.evidenceDirectory)
    : undefined;
  const targetPath = inspection?.resolvers.shellApplicationOriginal.targetPath
    ?? await resolveWindowsShortcutWithShellApplication(shortcutPath);
  if (targetPath.length === 0) {
    throw new Error(
      "Windows Desktop shortcut exists but Shell.Application exposed an empty target."
      + (inspection ? " Independent resolver evidence was preserved." : "")
    );
  }
  const [canonicalTargetPath, canonicalExecutablePath] = await Promise.all([
    realpath(targetPath),
    realpath(executablePath)
  ]);
  if (resolve(canonicalTargetPath).toLowerCase() !== resolve(canonicalExecutablePath).toLowerCase()) {
    throw new Error(
      `Windows Desktop shortcut target ${JSON.stringify(targetPath)} does not match the installed Pi-67 executable ${JSON.stringify(executablePath)}.`
    );
  }
  return { exists: true, targetsInstalledExecutable: true };
}

async function inspectWindowsShortcutTarget(shortcutPath, evidenceDirectory) {
  await access(shortcutPath);
  await mkdir(evidenceDirectory, { recursive: true });
  const preservedShortcutPath = join(evidenceDirectory, "desktop-shortcut-observed.lnk");
  await copyFile(shortcutPath, preservedShortcutPath);
  const bytes = await readFile(preservedShortcutPath);
  const resolvers = {
    wscriptOriginal: await captureShortcutResolver(() => (
      resolveWindowsShortcutWithWScript(shortcutPath)
    )),
    wscriptAsciiCopy: await captureShortcutResolver(() => (
      resolveWindowsShortcutWithWScript(preservedShortcutPath)
    )),
    shellApplicationOriginal: await captureShortcutResolver(() => (
      resolveWindowsShortcutWithShellApplication(shortcutPath)
    )),
    shellApplicationAsciiCopy: await captureShortcutResolver(() => (
      resolveWindowsShortcutWithShellApplication(preservedShortcutPath)
    ))
  };
  const inspection = {
    schemaVersion: 1,
    shortcutFile: {
      byteLength: bytes.byteLength,
      originalFileName: basename(shortcutPath),
      preservedFileName: basename(preservedShortcutPath),
      sha256: createHash("sha256").update(bytes).digest("hex")
    },
    resolvers
  };
  await writeFile(
    join(evidenceDirectory, "desktop-shortcut-inspection.json"),
    `${JSON.stringify(inspection, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return inspection;
}

async function resolveWindowsShortcutWithWScript(shortcutPath) {
  const command = [
    "$shortcutPath = [Environment]::GetEnvironmentVariable('PI67_WINDOWS_SHORTCUT_PATH', 'Process')",
    "$shell = New-Object -ComObject WScript.Shell",
    "$shortcut = $shell.CreateShortcut($shortcutPath)",
    "[Console]::Out.Write($shortcut.TargetPath)"
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command
  ], powershellOptions({ PI67_WINDOWS_SHORTCUT_PATH: shortcutPath }));
  return stdout.trim();
}

async function resolveWindowsShortcutWithShellApplication(shortcutPath) {
  const command = [
    "$shortcutPath = [Environment]::GetEnvironmentVariable('PI67_WINDOWS_SHORTCUT_PATH', 'Process')",
    "$shell = New-Object -ComObject Shell.Application",
    "$folder = $shell.NameSpace([IO.Path]::GetDirectoryName($shortcutPath))",
    "$item = if ($null -ne $folder) { $folder.ParseName([IO.Path]::GetFileName($shortcutPath)) }",
    "$link = if ($null -ne $item) { $item.GetLink }",
    "if ($null -ne $link) { [Console]::Out.Write([string]$link.Path) }"
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command
  ], powershellOptions({ PI67_WINDOWS_SHORTCUT_PATH: shortcutPath }));
  return stdout.trim();
}

async function captureShortcutResolver(resolveTarget) {
  try {
    return { status: "resolved", targetPath: await resolveTarget() };
  } catch (error) {
    return {
      status: "error",
      targetPath: "",
      error: error instanceof Error ? error.message.slice(0, 1_000) : "unknown resolver error"
    };
  }
}

function powershellOptions(environment) {
  return {
    encoding: "utf8",
    env: { ...process.env, ...environment },
    timeout: POWERSHELL_TIMEOUT_MS
  };
}
