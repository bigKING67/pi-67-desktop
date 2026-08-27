import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { WINDOWS_INSTALLER_PROCESS_TIMEOUT_MS } from "./windows-installer-lifecycle-contract.mjs";

const FILE_STATE_TIMEOUT_MS = 30_000;
const POWERSHELL_TIMEOUT_MS = 15_000;
const WINDOWS_POST_UPDATE_LAUNCH_TIMEOUT_MS = 30_000;
const WINDOWS_UPDATE_SURFACE_TIMEOUT_MS = 30_000;
const WINDOWS_TIMEOUT_DIAGNOSTIC_LEAD_MS = 30_000;
const execFileAsync = promisify(execFile);
export const WINDOWS_INSTALLATION_REMOVAL_TIMEOUT_MS = 90_000;

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

export function buildNsisUpdateArguments(installDirectory) {
  return ["--updated", "--force-run", ...buildNsisInstallArguments(installDirectory)];
}

export async function installNsisPackage(installerPath, installDirectory) {
  await runExecutable(installerPath, buildNsisInstallArguments(installDirectory));
  await waitForPathState(join(installDirectory, "Pi-67 Desktop.exe"), true);
}

export async function installNsisUpdatePackage(installerPath, installDirectory, options = {}) {
  const executablePath = join(installDirectory, "Pi-67 Desktop.exe");
  const [execution, updateSurface] = await Promise.allSettled([
    runExecutable(installerPath, buildNsisUpdateArguments(installDirectory), {
      captureBeforeTimeout: options.evidenceDirectory
        ? ({ processId }) => captureWindowsInstallerTimeoutSnapshot({
            desktopShortcutPath: options.desktopShortcutPath,
            evidenceDirectory: options.evidenceDirectory,
            installDirectory,
            installerPath,
            processId
          })
        : undefined
    }),
    waitForWindowsInstallerSurface(installerPath)
  ]);
  if (execution.status === "rejected") {
    const error = execution.reason instanceof Error
      ? execution.reason
      : new Error("NSIS update process failed with an unknown error.");
    error.windowsInstallerEvidence = {
      ...error.windowsInstallerEvidence,
      updateSurface: updateSurface.status === "fulfilled"
        ? { status: "observed", ...updateSurface.value }
        : { status: "not-observed", error: boundedDiagnosticError(updateSurface.reason) }
    };
    throw error;
  }
  if (updateSurface.status === "rejected") throw updateSurface.reason;
  await waitForPathState(executablePath, true);
  return {
    processId: await waitForWindowsExecutableLaunch(executablePath),
    updateSurface: updateSurface.value
  };
}

export async function resolveWindowsDesktopShortcutPath(shortcutName) {
  if (process.platform !== "win32") {
    throw new Error("Windows Desktop shortcut resolution requires win32.");
  }
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Console]::Out.Write([Environment]::GetFolderPath('Desktop'))"
  ], { encoding: "utf8", timeout: 15_000 });
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

export async function stopWindowsProcessTree(processId) {
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    throw new Error("Windows process ID must be a positive safe integer.");
  }
  let killError;
  try {
    await execFileAsync("taskkill.exe", ["/PID", String(processId), "/T", "/F"], {
      encoding: "utf8",
      timeout: 30_000
    });
  } catch (error) {
    killError = error;
  }
  if (!(await isWindowsProcessRunning(processId))) return;
  if (killError) {
    throw new Error(`taskkill failed to stop Windows process ${processId}.`, { cause: killError });
  }
  await waitForWindowsProcessExit(processId);
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

export function runExecutable(executablePath, argumentsList, options = {}) {
  return new Promise((resolvePromise, reject) => {
    let diagnosticTimer;
    let diagnosticCapture;
    const child = execFile(executablePath, argumentsList, {
      encoding: "utf8",
      maxBuffer: 256 * 1024,
      timeout: WINDOWS_INSTALLER_PROCESS_TIMEOUT_MS,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (diagnosticTimer !== undefined) clearTimeout(diagnosticTimer);
      void (async () => {
        const timeoutEvidence = diagnosticCapture ? await diagnosticCapture : undefined;
        if (!error) {
          resolvePromise();
          return;
        }
        const detail = [stdout, stderr].filter(Boolean).join("\n").slice(0, 4_096);
        const termination = [
          `timeoutMs=${WINDOWS_INSTALLER_PROCESS_TIMEOUT_MS}`,
          `killed=${String(error.killed ?? false)}`,
          `code=${String(error.code ?? "none")}`,
          `signal=${String(error.signal ?? "none")}`
        ].join(", ");
        const failure = new Error(
          `${basename(executablePath)} failed (${termination}): ${error.message}${detail ? `\n${detail}` : ""}`
        );
        failure.windowsInstallerEvidence = {
          launchedProcessId: child.pid ?? null,
          timeoutSnapshot: timeoutEvidence
        };
        reject(failure);
      })();
    });
    if (typeof options.captureBeforeTimeout === "function") {
      diagnosticTimer = setTimeout(() => {
        diagnosticCapture = Promise.resolve()
          .then(() => options.captureBeforeTimeout({ processId: child.pid }))
          .catch((error) => ({
            error: boundedDiagnosticError(error),
            status: "capture-failed"
          }));
      }, WINDOWS_INSTALLER_PROCESS_TIMEOUT_MS - WINDOWS_TIMEOUT_DIAGNOSTIC_LEAD_MS);
    }
  });
}

async function captureWindowsInstallerTimeoutSnapshot({
  desktopShortcutPath,
  evidenceDirectory,
  installDirectory,
  installerPath,
  processId
}) {
  await mkdir(evidenceDirectory, { recursive: true });
  const executablePath = join(installDirectory, "Pi-67 Desktop.exe");
  const command = [
    "$installerPath = [Environment]::GetEnvironmentVariable('PI67_WINDOWS_INSTALLER_PATH', 'Process')",
    "$installDirectory = [Environment]::GetEnvironmentVariable('PI67_WINDOWS_INSTALL_DIRECTORY', 'Process')",
    "$executablePath = [Environment]::GetEnvironmentVariable('PI67_WINDOWS_EXECUTABLE_PATH', 'Process')",
    "$shortcutPath = [Environment]::GetEnvironmentVariable('PI67_WINDOWS_SHORTCUT_PATH', 'Process')",
    "$rootProcessId = [int][Environment]::GetEnvironmentVariable('PI67_WINDOWS_PROCESS_ID', 'Process')",
    "function Test-ExactPath([string]$candidate, [string]$target) { if ([string]::IsNullOrWhiteSpace($candidate)) { return $false }; try { return [IO.Path]::GetFullPath($candidate).Equals([IO.Path]::GetFullPath($target), [StringComparison]::OrdinalIgnoreCase) } catch { return $false } }",
    "function Get-FileState([string]$path) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return [PSCustomObject]@{ exists = $false } }; $item = Get-Item -LiteralPath $path; $hash = $null; try { $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() } catch {}; return [PSCustomObject]@{ exists = $true; byteLength = [long]$item.Length; lastWriteUtc = $item.LastWriteTimeUtc.ToString('o'); sha256 = $hash } }",
    "$allProcesses = @(Get-CimInstance -ClassName Win32_Process)",
    "$treeIds = [System.Collections.Generic.HashSet[int]]::new()",
    "if ($rootProcessId -gt 0) { [void]$treeIds.Add($rootProcessId) }",
    "do { $added = $false; foreach ($entry in $allProcesses) { if ($treeIds.Contains([int]$entry.ParentProcessId) -and $treeIds.Add([int]$entry.ProcessId)) { $added = $true } } } while ($added)",
    "$observedProcesses = @($allProcesses | Where-Object { $treeIds.Contains([int]$_.ProcessId) -or (Test-ExactPath $_.ExecutablePath $installerPath) -or (Test-ExactPath $_.ExecutablePath $executablePath) } | ForEach-Object { $native = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; $title = if ($null -ne $native) { [string]$native.MainWindowTitle } else { '' }; if ($title.Length -gt 200) { $title = $title.Substring(0, 200) }; $roles = @(); if ($treeIds.Contains([int]$_.ProcessId)) { $roles += 'installer-tree' }; if (Test-ExactPath $_.ExecutablePath $installerPath) { $roles += 'installer-image' }; if (Test-ExactPath $_.ExecutablePath $executablePath) { $roles += 'installed-application' }; [PSCustomObject]@{ processId = [int]$_.ProcessId; parentProcessId = [int]$_.ParentProcessId; executableFileName = [IO.Path]::GetFileName([string]$_.ExecutablePath); roles = $roles; mainWindowVisible = ($null -ne $native -and $native.MainWindowHandle -ne 0); mainWindowTitle = $title; creationDate = [string]$_.CreationDate } })",
    "$uninstallers = @(); if (Test-Path -LiteralPath $installDirectory -PathType Container) { $uninstallers = @(Get-ChildItem -LiteralPath $installDirectory -Filter 'Uninstall*.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object { [PSCustomObject]@{ fileName = $_.Name; byteLength = [long]$_.Length; lastWriteUtc = $_.LastWriteTimeUtc.ToString('o') } }) }",
    "$installFileCount = if (Test-Path -LiteralPath $installDirectory -PathType Container) { @(Get-ChildItem -LiteralPath $installDirectory -File -ErrorAction SilentlyContinue).Count } else { 0 }",
    "$snapshot = [PSCustomObject]@{ schemaVersion = 1; capturedAt = [DateTime]::UtcNow.ToString('o'); launchedProcessId = $rootProcessId; processes = $observedProcesses; files = [PSCustomObject]@{ installedExecutable = Get-FileState $executablePath; desktopShortcut = Get-FileState $shortcutPath; installDirectoryExists = (Test-Path -LiteralPath $installDirectory -PathType Container); installFileCount = $installFileCount; uninstallers = $uninstallers } }",
    "[Console]::Out.Write(($snapshot | ConvertTo-Json -Compress -Depth 6))"
  ].join("\n");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command
  ], powershellOptions({
    PI67_WINDOWS_EXECUTABLE_PATH: executablePath,
    PI67_WINDOWS_INSTALL_DIRECTORY: installDirectory,
    PI67_WINDOWS_INSTALLER_PATH: installerPath,
    PI67_WINDOWS_PROCESS_ID: String(processId ?? 0),
    PI67_WINDOWS_SHORTCUT_PATH: desktopShortcutPath
  }));
  const snapshot = JSON.parse(stdout.trim());
  if (
    snapshot?.schemaVersion !== 1
    || !Array.isArray(snapshot.processes)
    || typeof snapshot.files !== "object"
    || snapshot.files === null
  ) {
    throw new Error("Windows installer timeout snapshot returned invalid evidence.");
  }
  const snapshotFileName = "windows-installer-timeout-snapshot.json";
  await writeFile(
    join(evidenceDirectory, snapshotFileName),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return {
    installedExecutable: snapshot.files.installedExecutable,
    observedProcessCount: snapshot.processes.length,
    snapshotFileName,
    status: "captured"
  };
}

function boundedDiagnosticError(error) {
  if (!(error instanceof Error)) return "unknown diagnostic error";
  return `${error.name}: ${error.code ?? "no-code"}`.slice(0, 200);
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

async function waitForWindowsExecutableLaunch(executablePath) {
  const deadline = Date.now() + WINDOWS_POST_UPDATE_LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const processId = await findWindowsMainProcess(executablePath);
    if (processId !== undefined) return processId;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("NSIS update did not automatically launch the updated Pi-67 executable.");
}

async function waitForWindowsInstallerSurface(installerPath) {
  const startedAt = performance.now();
  const deadline = Date.now() + WINDOWS_UPDATE_SURFACE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const observation = await findWindowsInstallerSurface(installerPath);
    if (observation) {
      return {
        ...observation,
        observedAfterMs: Math.round((performance.now() - startedAt) * 100) / 100
      };
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("NSIS update did not expose a visible installation progress surface.");
}

async function findWindowsInstallerSurface(installerPath) {
  const command = [
    "$targetPath = [Environment]::GetEnvironmentVariable('PI67_WINDOWS_INSTALLER_PATH', 'Process')",
    "$target = [IO.Path]::GetFullPath($targetPath)",
    "$match = Get-CimInstance -ClassName Win32_Process | Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).Equals($target, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($null -ne $process -and $process.MainWindowHandle -ne 0) { [PSCustomObject]@{ processId = [int]$_.ProcessId; mainWindowTitle = [string]$process.MainWindowTitle } } } | Select-Object -First 1",
    "if ($null -ne $match) { [Console]::Out.Write(($match | ConvertTo-Json -Compress)) }"
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command
  ], powershellOptions({ PI67_WINDOWS_INSTALLER_PATH: installerPath }));
  const value = stdout.trim();
  if (value.length === 0) return undefined;
  const parsed = JSON.parse(value);
  if (
    !Number.isSafeInteger(parsed?.processId)
    || parsed.processId <= 0
    || typeof parsed.mainWindowTitle !== "string"
    || parsed.mainWindowTitle.length > 200
  ) {
    throw new Error("NSIS update progress surface returned invalid process evidence.");
  }
  return { processId: parsed.processId, mainWindowTitle: parsed.mainWindowTitle };
}

export async function findWindowsMainProcess(executablePath) {
  const processPredicate = [
    "$_.ExecutablePath -and",
    "[IO.Path]::GetFullPath($_.ExecutablePath).Equals($target, [StringComparison]::OrdinalIgnoreCase) -and",
    "$_.CommandLine -notmatch '--type='"
  ].join(" ");
  const command = [
    "$targetPath = [Environment]::GetEnvironmentVariable('PI67_WINDOWS_EXECUTABLE_PATH', 'Process')",
    "$target = [IO.Path]::GetFullPath($targetPath)",
    `$match = Get-CimInstance -ClassName Win32_Process | Where-Object { ${processPredicate} } | Select-Object -First 1 -ExpandProperty ProcessId`,
    "if ($null -ne $match) { [Console]::Out.Write($match) }"
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command
  ], powershellOptions({ PI67_WINDOWS_EXECUTABLE_PATH: executablePath }));
  const value = stdout.trim();
  if (value.length === 0) return undefined;
  const processId = Number.parseInt(value, 10);
  return Number.isSafeInteger(processId) && processId > 0 ? processId : undefined;
}

async function isWindowsProcessRunning(processId) {
  const command = [
    "$processId = [Environment]::GetEnvironmentVariable('PI67_WINDOWS_PROCESS_ID', 'Process')",
    "if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { [Console]::Out.Write('1') }"
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command
  ], powershellOptions({ PI67_WINDOWS_PROCESS_ID: String(processId) }));
  return stdout.trim() === "1";
}

async function waitForWindowsProcessExit(processId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (!(await isWindowsProcessRunning(processId))) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for Windows process ${processId} to exit.`);
}

function powershellOptions(environment) {
  return {
    encoding: "utf8",
    env: { ...process.env, ...environment },
    timeout: POWERSHELL_TIMEOUT_MS
  };
}

export async function waitForInstallationRemoval(
  installDirectory,
  timeoutMs = WINDOWS_INSTALLATION_REMOVAL_TIMEOUT_MS
) {
  const deadline = Date.now() + timeoutMs;
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
