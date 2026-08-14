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
  CONTROLLED_MODEL_VALUE,
  resetControlledShutdownLifecycle,
  writeControlledShutdownExtension,
  writeShutdownLifecycleExtension
} from "./controlled-shutdown-fixture.ts";
import {
  assertPackagedRuntimeAssets,
  resolvePackagedRuntimeAssetContract,
  repositoryRoot
} from "./packaged-electron-fixture.mjs";
import { assertSameArtifactBytes } from "./windows-artifact-identity.mjs";
import {
  launchInstalledApplication,
  resolveInstalledUserInterfaceContract
} from "./windows-installed-application-lifecycle.mjs";
import {
  parseWindowsInstallerLifecycleArguments,
  resolveWindowsInstallerLifecycleContract
} from "./windows-installer-lifecycle-contract.mjs";
import {
  cleanupWindowsInstallation,
  installNsisPackage,
  resolveUninstallerPath,
  runExecutable,
  waitForInstallationRemoval,
  waitForPathState
} from "./windows-installer-process.mjs";
import { verifyInstalledRealUserLifecycle } from "./windows-real-user-lifecycle.mjs";
import {
  assertWindowsExistingProfileInteractionPreserved,
  assertWindowsExistingProfilePreserved,
  inspectCleanWindowsRealUserProfile,
  prepareFreshWindowsRealUserProfile,
  prepareWindowsRealUserProfile,
  readWindowsExistingProfileSettings,
  resolveWindowsRealUserProfilePaths,
  snapshotWindowsExistingProfile,
  WINDOWS_REAL_USER_CONFIGURED_PROVIDER
} from "./windows-real-user-profile.mjs";
import {
  readLifecycleArtifactIdentity,
  resolveExpectedLifecycleSigner,
  resolveInstalledArtifact,
  resolveUpgradeBaselineInstaller,
  resolveWindowsInstallerPath
} from "./windows-installer-identity.mjs";
export { resolveExpectedLifecycleSigner, resolveUpgradeBaselineInstaller, resolveWindowsInstallerPath };
export {
  parseWindowsInstallerLifecycleArguments,
  resolveWindowsInstallerLifecycleContract,
  WINDOWS_INSTALLER_PROCESS_TIMEOUT_MS
} from "./windows-installer-lifecycle-contract.mjs";
export {
  buildNsisInstallArguments,
  waitForPathState
} from "./windows-installer-process.mjs";
const outputDirectory = join(repositoryRoot, "artifacts/validation/windows-installer-lifecycle");
const summaryPath = join(outputDirectory, "summary.json");
const [controlledProvider, controlledModelId] = CONTROLLED_MODEL_VALUE.split("/");

export async function verifyWindowsInstallerLifecycle(options = {}) {
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
  const lifecycleContract = resolveWindowsInstallerLifecycleContract({
    baseline: Boolean(baseline),
    quick: options.quick === true
  });
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const root = await mkdtemp(join(tmpdir(), "pi67-windows-installer-"));
  const installDirectory = join(root, "Pi-67 Desktop 中文安装路径");
  const userDataDirectory = join(root, "用户数据 含空格");
  const {
    agentDir,
    environmentDriftAgentDir,
    extensionsDirectory,
    lifecycleAgentDir,
    lifecycleEnvironmentDriftAgentDir,
    lifecycleExtensionsDirectory,
    lifecycleUserDataDirectory,
    cleanLifecycleAgentDir,
    cleanLifecycleEnvironmentDriftAgentDir,
    cleanLifecycleUserDataDirectory
  } = resolveWindowsRealUserProfilePaths(root);
  const workspace = join(root, "中文工作区 包含空格");
  const childPidPath = join(root, "controlled-child.pid");
  const lifecyclePath = join(root, "controlled-lifecycle.txt");
  const report = {
    schemaVersion: 2,
    status: "running",
    certificationMode: lifecycleContract.certificationMode,
    evidenceLevel: lifecycleContract.evidenceLevel,
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
    configurationProfile: {
      agentDirectoryClass: "localized-space",
      environmentDriftProbe: true,
      expectedConfiguredProvider: WINDOWS_REAL_USER_CONFIGURED_PROVIDER,
      lanes: ["clean-profile", "existing-pi-profile"]
    },
    phases: [],
    notVerified: [
      "interactive assisted installer UI",
      "SmartScreen reputation or user override flow",
      ...(baseline ? [] : ["upgrade from a distinct previously released version"]),
      ...(lifecycleContract.verifyReinstall ? [] : ["same-version reinstall and restored-startup persistence"]),
      "machine-wide installation",
      "real user default-path uninstall data retention",
      "uncontrolled real-world Pi TUI profiles",
      "Defender/EDR, OneDrive or redirected storage"
    ]
  };
  await writeReport(report);

  try {
    await Promise.all([
      prepareWindowsRealUserProfile({
        agentDir,
        environmentDriftAgentDir,
        extensionsDirectory,
        lifecycleAgentDir,
        lifecycleEnvironmentDriftAgentDir,
        lifecycleExtensionsDirectory,
        cleanLifecycleEnvironmentDriftAgentDir
      }),
      mkdir(userDataDirectory, { recursive: true }),
      mkdir(lifecycleUserDataDirectory, { recursive: true }),
      mkdir(cleanLifecycleUserDataDirectory, { recursive: true }),
      mkdir(join(workspace, ".git"), { recursive: true })
    ]);
    await Promise.all([
      writeFile(join(workspace, "README.md"), "Windows installed lifecycle fixture.\n", "utf8"),
      writeFile(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8"),
      writeFile(join(workspace, ".git", "config"), "[core]\n\trepositoryformatversion = 0\n\tbare = false\n", "utf8")
    ]);
    const extensionPath = join(extensionsDirectory, "installer-lifecycle-fixture.ts");
    const lifecycleExtensionPath = join(lifecycleExtensionsDirectory, "installer-lifecycle-fixture.ts");
    await writeControlledShutdownExtension({
      extensionPath: lifecycleExtensionPath,
      childPidPath,
      lifecyclePath
    });
    const existingProfileBefore = await snapshotWindowsExistingProfile(lifecycleAgentDir);
    const existingProfileSettingsBefore = await readWindowsExistingProfileSettings(lifecycleAgentDir);
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
    const initialRuntimeAssetContract = resolvePackagedRuntimeAssetContract(initialVersion);
    await assertPackagedRuntimeAssets(installedArtifact, initialRuntimeAssetContract);
    report.initialRuntimeAssetContract = {
      packageWorkerIsolated: initialRuntimeAssetContract.packageWorkerIsolated,
      requiredAsarPathCount: initialRuntimeAssetContract.requiredAsarPaths.length,
      requireWindowsPackageWorkerJob: initialRuntimeAssetContract.requireWindowsPackageWorkerJob,
      version: initialVersion
    };
    const initialUserInterfaceContract = resolveInstalledUserInterfaceContract(initialVersion);
    report.initialUserInterfaceContract = { ...initialUserInterfaceContract, version: initialVersion };
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
      legacyUserInterface: initialUserInterfaceContract.legacyUserInterface,
      lifecyclePath,
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

    let finalInstalledArtifact = installedArtifact;
    if (lifecycleContract.verifyReinstall) {
      if (baseline) {
        await writeControlledShutdownExtension({ extensionPath, childPidPath, lifecyclePath });
      }

      const reinstall = await timedPhase(
        baseline ? "upgrade" : "reinstall",
        () => installNsisPackage(installerPath, installDirectory)
      );
      report.phases.push(reinstall);
      finalInstalledArtifact = await resolveInstalledArtifact(installDirectory);
      await assertPackagedRuntimeAssets(finalInstalledArtifact);
      const finalInstalledIdentity = await readLifecycleArtifactIdentity(
        finalInstalledArtifact.executablePath,
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
        artifact: finalInstalledArtifact,
        childPidPath,
        expectedTheme: "light",
        legacyUserInterface: resolveInstalledUserInterfaceContract(packageJson.version).legacyUserInterface,
        lifecyclePath,
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
    }

    const cleanProfileLifecycle = await verifyInstalledRealUserLifecycle({
      agentDir: cleanLifecycleAgentDir,
      artifact: finalInstalledArtifact,
      environmentDriftAgentDir: cleanLifecycleEnvironmentDriftAgentDir,
      initializeFirstLaunch: ({ provisioningTimeoutMs }) => prepareFreshWindowsRealUserProfile({
        agentDir: cleanLifecycleAgentDir,
        provisioningTimeoutMs,
        writeControlledExtension: (extensionPath) => writeControlledShutdownExtension({
          extensionPath,
          childPidPath,
          lifecyclePath
        })
      }),
      lane: "clean-profile",
      userDataDirectory: cleanLifecycleUserDataDirectory,
      workspace
    });
    const cleanProfileProvisioning = await inspectCleanWindowsRealUserProfile(cleanLifecycleAgentDir);
    report.phases.push({
      name: "clean-profile-lifecycle",
      provisioning: cleanProfileProvisioning,
      ...cleanProfileLifecycle
    });

    const existingProfileLifecycle = await verifyInstalledRealUserLifecycle({
      agentDir: lifecycleAgentDir,
      artifact: finalInstalledArtifact,
      environmentDriftAgentDir: lifecycleEnvironmentDriftAgentDir,
      lane: "existing-pi-profile",
      userDataDirectory: lifecycleUserDataDirectory,
      verifyInitialProfileState: () => assertWindowsExistingProfilePreserved(
        lifecycleAgentDir,
        existingProfileBefore
      ),
      workspace
    });
    const existingProfilePreservation = await assertWindowsExistingProfileInteractionPreserved(
      lifecycleAgentDir,
      existingProfileBefore,
      existingProfileSettingsBefore,
      { provider: controlledProvider, id: controlledModelId }
    );
    report.phases.push({
      name: "existing-pi-profile-lifecycle",
      preservation: existingProfilePreservation,
      ...existingProfileLifecycle
    });

    const uninstallPath = await resolveUninstallerPath(installDirectory);
    const uninstall = await timedPhase("uninstall", async () => {
      await runExecutable(uninstallPath, ["/S"]);
      await waitForPathState(finalInstalledArtifact.executablePath, false);
      await waitForInstallationRemoval(installDirectory);
    });
    report.phases.push(uninstall);
    const [preservedEntries, preservedLifecycleEntries, preservedCleanLifecycleEntries] = await Promise.all([
      assertPreservedUserData(userDataDirectory),
      assertPreservedUserData(lifecycleUserDataDirectory),
      assertPreservedUserData(cleanLifecycleUserDataDirectory)
    ]);
    report.userData = {
      lifecycleProfileTopLevelEntryCount: preservedLifecycleEntries.length,
      cleanLifecycleProfileTopLevelEntryCount: preservedCleanLifecycleEntries.length,
      preservedAfterUninstall: true,
      topLevelEntryCount: preservedEntries.length
    };
    report.status = "passed";
    await writeReport(report);
    const reinstallEvidence = lifecycleContract.verifyReinstall
      ? `${baseline ? "cross-version upgrade" : "same-version reinstall"} with theme persistence, `
      : "";
    console.log(
      `Windows NSIS ${lifecycleContract.certificationMode} lifecycle smoke passed: silent install, `
      + "installed app:// launch, controlled process shutdown, Provider/Catalog/create hard gates, "
      + `${cleanProfileLifecycle.restartCount} clean-profile restarts and `
      + `${existingProfileLifecycle.restartCount} existing-pi-profile restarts, `
      + reinstallEvidence
      + "silent uninstall, and isolated user-data preservation. "
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

export async function assertPreservedUserData(userDataDirectory) {
  const entries = await readdir(userDataDirectory);
  if (entries.length === 0) {
    throw new Error("Windows uninstall removed or emptied the isolated Electron user-data directory.");
  }
  return entries;
}

function assertRuntimeVersion(launchResult, expectedVersion) {
  if (launchResult.runtime.appVersion !== expectedVersion) {
    throw new Error(`Installed app version mismatch: expected ${expectedVersion}, got ${launchResult.runtime.appVersion}.`);
  }
}

async function timedPhase(name, action) {
  const startedAt = performance.now();
  await action();
  return { durationMs: round(performance.now() - startedAt), name };
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
  await verifyWindowsInstallerLifecycle(
    parseWindowsInstallerLifecycleArguments(process.argv.slice(2))
  );
}
