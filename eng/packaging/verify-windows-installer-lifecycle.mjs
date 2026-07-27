import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { release, tmpdir, version as osVersion } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSingleShutdownQuitLifecycle,
  resetControlledShutdownLifecycle,
  writeControlledShutdownExtension,
  writeShutdownLifecycleExtension
} from "./controlled-shutdown-fixture.ts";
import {
  assertPackagedRuntimeAssets,
  repositoryRoot
} from "./packaged-electron-fixture.mjs";
import { assertSameArtifactBytes } from "./windows-artifact-identity.mjs";
import { launchInstalledApplication } from "./windows-installed-application-lifecycle.mjs";
import {
  readLifecycleArtifactIdentity,
  resolveExpectedLifecycleSigner,
  resolveInstalledArtifact,
  resolveUpgradeBaselineInstaller,
  resolveWindowsInstallerPath
} from "./windows-installer-identity.mjs";

export { resolveExpectedLifecycleSigner, resolveUpgradeBaselineInstaller, resolveWindowsInstallerPath };

const INSTALLER_TIMEOUT_MS = 120_000;
const FILE_STATE_TIMEOUT_MS = 30_000;
const outputDirectory = join(repositoryRoot, "artifacts/validation/windows-installer-lifecycle");
const summaryPath = join(outputDirectory, "summary.json");

export async function verifyWindowsInstallerLifecycle() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(`Windows installer lifecycle verification requires win32/x64, got ${process.platform}/${process.arch}.`);
  }

  const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  const installerPath = resolveWindowsInstallerPath(
    join(repositoryRoot, "artifacts/release"),
    packageJson.version
  );
  await access(installerPath);
  const expectedSigner = resolveExpectedLifecycleSigner(
    process.env.PI67_EXPECTED_WINDOWS_SIGNER_THUMBPRINT
  );
  const installerIdentity = await readLifecycleArtifactIdentity(
    installerPath,
    expectedSigner,
    "Current Windows installer"
  );
  const packagedExecutablePath = join(
    repositoryRoot,
    "artifacts/release/win-unpacked/Pi-67 Desktop.exe"
  );
  const packagedExecutableIdentity = await readLifecycleArtifactIdentity(
    packagedExecutablePath,
    expectedSigner,
    "Packaged Windows executable"
  );
  const baseline = resolveUpgradeBaselineInstaller(
    process.env.PI67_WINDOWS_BASELINE_INSTALLER,
    packageJson.version
  );
  const baselineIdentity = baseline
    ? await readLifecycleArtifactIdentity(baseline.path, expectedSigner, "Previous Windows installer")
    : undefined;
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const root = await mkdtemp(join(tmpdir(), "pi67-windows-installer-"));
  const installDirectory = join(root, "Pi-67 Desktop 中文安装路径");
  const userDataDirectory = join(root, "user-data");
  const agentDir = join(root, "agent");
  const extensionsDirectory = join(agentDir, "extensions");
  const workspace = join(root, "中文工作区 包含空格");
  const childPidPath = join(root, "controlled-child.pid");
  const lifecyclePath = join(root, "controlled-lifecycle.txt");
  const report = {
    schemaVersion: 1,
    status: "running",
    evidenceLevel: baseline
      ? "windows-nsis-cross-version-upgrade-uninstall"
      : "windows-nsis-silent-install-reinstall-uninstall",
    host: {
      arch: process.arch,
      osRelease: release(),
      osVersion: osVersion(),
      platform: process.platform,
      runnerName: process.env.RUNNER_NAME ?? null
    },
    artifact: {
      fileName: basename(installerPath),
      ...installerIdentity,
      version: packageJson.version
    },
    packagedExecutable: {
      fileName: basename(packagedExecutablePath),
      ...packagedExecutableIdentity
    },
    baselineArtifact: baseline ? {
      fileName: basename(baseline.path),
      ...baselineIdentity,
      version: baseline.version
    } : null,
    phases: [],
    notVerified: [
      "interactive assisted installer UI",
      "SmartScreen reputation or user override flow",
      ...(baseline ? [] : ["upgrade from a distinct previously released version"]),
      "machine-wide installation",
      "real user default-path uninstall data retention"
    ]
  };
  await writeReport(report);

  try {
    await Promise.all([
      mkdir(extensionsDirectory, { recursive: true }),
      mkdir(userDataDirectory, { recursive: true }),
      mkdir(workspace, { recursive: true })
    ]);
    const extensionPath = join(extensionsDirectory, "installer-lifecycle-fixture.ts");
    if (baseline) {
      await writeShutdownLifecycleExtension({ extensionPath, lifecyclePath });
    } else {
      await writeControlledShutdownExtension({ extensionPath, childPidPath, lifecyclePath });
    }

    const initialInstallerPath = baseline?.path ?? installerPath;
    const initialVersion = baseline?.version ?? packageJson.version;
    const firstInstall = await timedPhase(
      baseline ? "baseline-install" : "install",
      () => installNsisPackage(initialInstallerPath, installDirectory)
    );
    report.phases.push(firstInstall);
    const installedArtifact = await resolveInstalledArtifact(installDirectory);
    await assertPackagedRuntimeAssets(installedArtifact);
    const initialInstalledIdentity = await readLifecycleArtifactIdentity(
      installedArtifact.executablePath,
      expectedSigner,
      "Initially installed Windows executable"
    );
    if (!baseline) {
      assertSameArtifactBytes(
        initialInstalledIdentity,
        packagedExecutableIdentity,
        "Initially installed Windows executable"
      );
    }
    report.initialInstalledExecutable = initialInstalledIdentity;

    await resetControlledShutdownLifecycle(lifecyclePath);
    const firstLaunch = await launchInstalledApplication({
      activeControlledOperation: !baseline,
      agentDir,
      artifact: installedArtifact,
      childPidPath,
      expectedTheme: "system",
      legacyUserInterface: Boolean(baseline),
      probePackagedRendererIsolation: !baseline,
      selectLightTheme: true,
      userDataDirectory,
      workspace
    });
    assertRuntimeVersion(firstLaunch, initialVersion);
    if (!baseline) {
      await assertSingleShutdownQuitLifecycle(lifecyclePath, "Initially installed Pi Runtime");
    }
    report.phases.push({
      name: baseline ? "baseline-launch" : "first-launch",
      ...firstLaunch,
      sessionShutdownLifecycle: baseline ? "legacy-baseline-not-required" : "verified"
    });

    if (baseline) {
      await writeControlledShutdownExtension({ extensionPath, childPidPath, lifecyclePath });
    }

    const reinstall = await timedPhase(
      baseline ? "upgrade" : "reinstall",
      () => installNsisPackage(installerPath, installDirectory)
    );
    report.phases.push(reinstall);
    const reinstalledArtifact = await resolveInstalledArtifact(installDirectory);
    await assertPackagedRuntimeAssets(reinstalledArtifact);
    const finalInstalledIdentity = await readLifecycleArtifactIdentity(
      reinstalledArtifact.executablePath,
      expectedSigner,
      "Upgraded Windows executable"
    );
    assertSameArtifactBytes(
      finalInstalledIdentity,
      packagedExecutableIdentity,
      "Upgraded Windows executable"
    );
    report.finalInstalledExecutable = finalInstalledIdentity;

    await resetControlledShutdownLifecycle(lifecyclePath);
    const secondLaunch = await launchInstalledApplication({
      activeControlledOperation: Boolean(baseline),
      agentDir,
      artifact: reinstalledArtifact,
      expectedTheme: "light",
      legacyUserInterface: false,
      probePackagedRendererIsolation: true,
      selectLightTheme: false,
      userDataDirectory,
      workspace
    });
    assertRuntimeVersion(secondLaunch, packageJson.version);
    await assertSingleShutdownQuitLifecycle(lifecyclePath, "Upgraded Pi Runtime");
    report.phases.push({
      name: baseline ? "post-upgrade-launch" : "post-reinstall-launch",
      ...secondLaunch,
      sessionShutdownLifecycle: "verified"
    });

    const uninstallPath = await resolveUninstallerPath(installDirectory);
    const uninstall = await timedPhase("uninstall", async () => {
      await runExecutable(uninstallPath, ["/S"]);
      await waitForPathState(reinstalledArtifact.executablePath, false);
      await waitForInstallationRemoval(installDirectory);
    });
    report.phases.push(uninstall);
    const preservedEntries = await assertPreservedUserData(userDataDirectory);
    report.userData = {
      preservedAfterUninstall: true,
      topLevelEntryCount: preservedEntries.length
    };
    report.status = "passed";
    await writeReport(report);
    console.log(
      "Windows NSIS lifecycle smoke passed: silent install, installed app:// launch, controlled process shutdown, "
      + `${baseline ? "cross-version upgrade" : "same-version reinstall"} with theme persistence, silent uninstall, `
      + "and isolated user-data preservation. "
      + `Evidence: ${relative(repositoryRoot, summaryPath)}.`
    );
  } catch (error) {
    report.status = "failed";
    report.error = boundedErrorMessage(error, root);
    await writeReport(report);
    throw error;
  } finally {
    await cleanupWindowsInstallation(installDirectory).catch((error) => {
      console.warn(`Windows installer cleanup warning: ${boundedErrorMessage(error, root)}`);
    });
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

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

export async function assertPreservedUserData(userDataDirectory) {
  const entries = await readdir(userDataDirectory);
  if (entries.length === 0) {
    throw new Error("Windows uninstall removed or emptied the isolated Electron user-data directory.");
  }
  return entries;
}

async function installNsisPackage(installerPath, installDirectory) {
  await runExecutable(installerPath, buildNsisInstallArguments(installDirectory));
  await waitForPathState(join(installDirectory, "Pi-67 Desktop.exe"), true);
}

async function resolveUninstallerPath(installDirectory) {
  const matches = (await readdir(installDirectory))
    .filter((name) => /^Uninstall.*\.exe$/iu.test(name));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one NSIS uninstaller, found ${matches.length}.`);
  }
  return join(installDirectory, matches[0]);
}

async function cleanupWindowsInstallation(installDirectory) {
  if (!(await pathExists(installDirectory))) return;
  const matches = (await readdir(installDirectory).catch(() => []))
    .filter((name) => /^Uninstall.*\.exe$/iu.test(name));
  if (matches.length === 1) {
    await runExecutable(join(installDirectory, matches[0]), ["/S"]);
    await waitForInstallationRemoval(installDirectory);
  }
}

function assertRuntimeVersion(launchResult, expectedVersion) {
  if (launchResult.runtime.appVersion !== expectedVersion) {
    throw new Error(`Installed app version mismatch: expected ${expectedVersion}, got ${launchResult.runtime.appVersion}.`);
  }
}

function runExecutable(executablePath, argumentsList) {
  return new Promise((resolvePromise, reject) => {
    execFile(executablePath, argumentsList, {
      encoding: "utf8",
      maxBuffer: 256 * 1024,
      timeout: INSTALLER_TIMEOUT_MS,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = [stdout, stderr].filter(Boolean).join("\n").slice(0, 4_096);
        reject(new Error(`${basename(executablePath)} failed: ${error.message}${detail ? `\n${detail}` : ""}`));
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

async function waitForInstallationRemoval(installDirectory) {
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

async function timedPhase(name, action) {
  const startedAt = performance.now();
  await action();
  return { durationMs: round(performance.now() - startedAt), name };
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeReport(report) {
  await writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function boundedErrorMessage(error, privateRoot) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(privateRoot, "<temporary-root>").slice(0, 2_000);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyWindowsInstallerLifecycle();
}
