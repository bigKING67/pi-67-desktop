import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTROL_MUTATION_ACK_TIMEOUT_MS } from "@pi67/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectInstalledShutdownLifecycle,
  INSTALLED_RUNTIME_READINESS_TIMEOUT_MS,
  waitForControlledPromptProjection
} from "./windows-installed-application-lifecycle.mjs";
import {
  parseInitializationObservations,
  REAL_USER_CATALOG_TIMEOUT_MS,
  REAL_USER_CREATE_HARD_TIMEOUT_MS,
  REAL_USER_CREATE_TARGET_MS,
  REAL_USER_MODEL_HYDRATION_TIMEOUT_MS,
  REAL_USER_MODEL_RUNTIME_TIMEOUT_MS,
  REAL_USER_PROVIDER_TIMEOUT_MS,
  REAL_USER_RESTART_COUNT
} from "./windows-real-user-lifecycle.mjs";
import {
  createSessionCreationDiagnostic
} from "./windows-installer-identity.mjs";
import {
  assertPreservedUserData,
  buildNsisInstallArguments,
  buildNsisUpdateArguments,
  parseWindowsInstallerLifecycleArguments,
  prepareInitialDesktopShortcutEvidence,
  resolveExpectedLifecycleSigner,
  resolveUpgradeBaselineInstaller,
  resolveWindowsInstallerLifecycleContract,
  resolveWindowsInstallerPath,
  waitForInstallationRemoval,
  waitForPathState,
  WINDOWS_INSTALLATION_REMOVAL_TIMEOUT_MS,
  WINDOWS_INSTALLER_PROCESS_TIMEOUT_MS
} from "./verify-windows-installer-lifecycle.mjs";
import {
  findWindowsMainProcess
} from "./windows-installer-process.mjs";

const temporaryDirectories = [];
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const WINDOWS_PROCESS_PROBE_TEST_TIMEOUT_MS = 20_000;

it("retains redacted Session creation notification details", () => {
  expect(createSessionCreationDiagnostic({
    errorNotificationCount: 1,
    errorNotificationMessages: ["无法创建 Pi 会话：safe detail"],
    errorNotificationTitles: ["无法创建 Pi 会话"]
  })).toMatchObject({
    errorNotificationCount: 1,
    errorNotificationMessages: ["无法创建 Pi 会话：safe detail"],
    errorNotificationTitles: ["无法创建 Pi 会话"]
  });
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("Windows installer lifecycle contract", () => {
  it("defaults to full certification and accepts an explicit quick lane", () => {
    expect(parseWindowsInstallerLifecycleArguments([])).toEqual({ quick: false });
    expect(parseWindowsInstallerLifecycleArguments(["--quick"])).toEqual({ quick: true });
    expect(() => parseWindowsInstallerLifecycleArguments(["--full"])).toThrow(
      "Expected no arguments or --quick"
    );
  });

  it("keeps upgrade and release evidence on the full lifecycle contract", () => {
    expect(resolveWindowsInstallerLifecycleContract({ baseline: false, quick: true })).toEqual({
      certificationMode: "quick",
      evidenceLevel: "windows-nsis-silent-install-dual-profile-lifecycle-uninstall",
      verifyReinstall: false
    });
    expect(resolveWindowsInstallerLifecycleContract({ baseline: false, quick: false })).toEqual({
      certificationMode: "full",
      evidenceLevel: "windows-nsis-silent-install-reinstall-dual-profile-lifecycle-uninstall",
      verifyReinstall: true
    });
    expect(resolveWindowsInstallerLifecycleContract({ baseline: true, quick: false })).toEqual({
      certificationMode: "full",
      evidenceLevel: "windows-nsis-cross-version-upgrade-dual-profile-lifecycle-uninstall",
      verifyReinstall: true
    });
    expect(() => resolveWindowsInstallerLifecycleContract({ baseline: true, quick: true }))
      .toThrow("cannot verify a cross-version upgrade baseline");
  });

  it("resolves the exact current-version x64 NSIS artifact", () => {
    expect(resolveWindowsInstallerPath("C:\\release", "0.1.0-alpha.3"))
      .toBe(join("C:\\release", "Pi-67-Desktop-0.1.0-alpha.3-win-x64.exe"));
    expect(() => resolveWindowsInstallerPath("C:\\release", "latest"))
      .toThrow("Invalid package version");
  });

  it("keeps the silent NSIS destination argument last and rejects control characters", () => {
    expect(buildNsisInstallArguments("C:\\Pi-67 Desktop 中文"))
      .toEqual(["/S", "/D=C:\\Pi-67 Desktop 中文"]);
    expect(buildNsisUpdateArguments("C:\\Pi-67 Desktop 中文"))
      .toEqual([
        "--updated",
        "--force-run",
        "/S",
        "/D=C:\\Pi-67 Desktop 中文"
      ]);
    expect(() => buildNsisInstallArguments("C:\\Pi-67\nDesktop"))
      .toThrow("single-line path");
  });

  it("keeps enough process-timeout margin for variable GitHub Windows installer performance", () => {
    expect(WINDOWS_INSTALLER_PROCESS_TIMEOUT_MS).toBe(240_000);
  });

  it("executes the main-process PowerShell probe on Windows", async () => {
    if (process.platform !== "win32") return;

    await expect(findWindowsMainProcess(process.execPath)).resolves.toBeGreaterThan(0);
  }, WINDOWS_PROCESS_PROBE_TEST_TIMEOUT_MS);

  it("models a missing baseline Desktop shortcut before cross-version repair", async () => {
    const root = await createTemporaryDirectory();
    const shortcutPath = join(root, "π.lnk");
    await writeFile(shortcutPath, "stale shortcut", "utf8");

    await expect(prepareInitialDesktopShortcutEvidence({
      baseline: { version: "0.1.0-alpha.33" },
      desktopShortcutPath: shortcutPath,
      installedExecutablePath: join(root, "Pi-67 Desktop.exe")
    })).resolves.toEqual({
      exists: false,
      repairScenario: "missing-before-cross-version-upgrade"
    });
    await expect(readFile(shortcutPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows bounded time for deferred NSIS self-cleanup", async () => {
    expect(WINDOWS_INSTALLATION_REMOVAL_TIMEOUT_MS).toBe(90_000);
    const root = await createTemporaryDirectory();
    const installDirectory = join(root, "Pi-67 Desktop");
    await mkdir(installDirectory, { recursive: true });
    await writeFile(join(installDirectory, "Uninstall Pi-67 Desktop.exe"), "pending");
    const cleanup = setTimeout(() => {
      void rm(installDirectory, { recursive: true, force: true });
    }, 75);

    try {
      await waitForInstallationRemoval(installDirectory, 1_000);
    } finally {
      clearTimeout(cleanup);
    }
  });

  it("aligns installed runtime readiness with the replay-safe control mutation timeout", () => {
    expect(INSTALLED_RUNTIME_READINESS_TIMEOUT_MS)
      .toBe(CONTROL_MUTATION_ACK_TIMEOUT_MS + 15_000);
  });

  it("enforces bounded real-user Provider, Catalog, create and restart gates", async () => {
    expect({
      catalog: REAL_USER_CATALOG_TIMEOUT_MS,
      createHard: REAL_USER_CREATE_HARD_TIMEOUT_MS,
      createTarget: REAL_USER_CREATE_TARGET_MS,
      modelHydration: REAL_USER_MODEL_HYDRATION_TIMEOUT_MS,
      modelRuntime: REAL_USER_MODEL_RUNTIME_TIMEOUT_MS,
      provider: REAL_USER_PROVIDER_TIMEOUT_MS,
      restarts: REAL_USER_RESTART_COUNT
    }).toEqual({
      catalog: 5_000,
      createHard: 15_000,
      createTarget: 5_000,
      modelHydration: 30_000,
      modelRuntime: 5_000,
      provider: 10_000,
      restarts: 3
    });

    const source = await readFile(
      join(repositoryRoot, "eng/packaging/verify-windows-installer-lifecycle.mjs"),
      "utf8"
    );
    const updateSource = await readFile(
      join(repositoryRoot, "eng/packaging/windows-installer-update-lifecycle.mjs"),
      "utf8"
    );
    const processSource = await readFile(
      join(repositoryRoot, "eng/packaging/windows-installer-process.mjs"),
      "utf8"
    );
    const cleanProfileGate = source.indexOf("const cleanProfileLifecycle = await verifyInstalledRealUserLifecycle({");
    const existingProfileGate = source.indexOf("const existingProfileLifecycle = await verifyInstalledRealUserLifecycle({");
    const uninstall = source.indexOf("const uninstallPath = await resolveUninstallerPath");
    expect(cleanProfileGate).toBeGreaterThan(-1);
    expect(existingProfileGate).toBeGreaterThan(cleanProfileGate);
    expect(uninstall).toBeGreaterThan(existingProfileGate);
    expect(source).toContain('lane: "clean-profile"');
    expect(source).toContain('lane: "existing-pi-profile"');
    expect(source).toContain("initializeFirstLaunch: ({ provisioningTimeoutMs })");
    expect(source).toContain("provisioningTimeoutMs,");
    expect(source).toContain("resolvePackagedRuntimeAssetContract(initialVersion)");
    expect(source).toContain("resolveInstalledUserInterfaceContract(initialVersion)");
    expect(source).toContain("assertPackagedRuntimeAssets(installedArtifact, initialRuntimeAssetContract)");
    expect(source).toContain("await verifyWindowsInstallerUpdateLifecycle({");
    expect(source).toContain("repairScenario: \"missing-before-cross-version-upgrade\"");
    expect(updateSource).toContain("await assertPackagedRuntimeAssets(installedArtifact)");
    expect(updateSource).toContain("processId = await installNsisUpdatePackage(");
    expect(updateSource).toContain("automaticPostInstallLaunch: true");
    expect(updateSource).toContain("desktopShortcut: await assertWindowsShortcutTarget(");
    expect(updateSource).toContain("{ evidenceDirectory: shortcutEvidenceDirectory }");
    expect(updateSource).toMatch(/finally \{[\s\S]*?await stopWindowsProcessTree\(processId\)/u);
    expect(processSource).not.toContain("$args[0]");
    expect(processSource).toContain("PI67_WINDOWS_SHORTCUT_PATH");
    expect(processSource).toContain("PI67_WINDOWS_EXECUTABLE_PATH");
    expect(processSource).toContain("PI67_WINDOWS_PROCESS_ID");
    expect(source).toContain("verifyInitialProfileState: () => assertWindowsExistingProfilePreserved(");
    expect(source).toContain("await assertWindowsExistingProfileInteractionPreserved(");
  });

  it("keeps initialization evidence structured and drops unrelated or malformed output", () => {
    expect(parseInitializationObservations([
      "unrelated output",
      '[agent-host:init] {"stage":"create-session","outcome":"started","durationMs":0}',
      '[agent-host:init] {"stage":"create-session","outcome":"completed","durationMs":24.6}',
      '[agent-host:init] {"stage":"load-model-runtime","outcome":"completed","durationMs":41.4}',
      '[agent-host:init] {"stage":"private-path","outcome":"completed","durationMs":1}',
      "[agent-host:init] not-json"
    ].join("\n"))).toEqual([
      { stage: "create-session", outcome: "started", durationMs: 0 },
      { stage: "create-session", outcome: "completed", durationMs: 25 },
      { stage: "load-model-runtime", outcome: "completed", durationMs: 41 }
    ]);
  });

  it("waits for the controlled prompt projection before measuring installed shutdown", async () => {
    const actions = [];
    const locator = (selector) => ({
      filter: ({ hasText }) => {
        actions.push(`filter:${selector}:${hasText}`);
        return locator(`${selector}:filtered`);
      },
      getByText: (text, options) => {
        actions.push(`text:${selector}:${text}:${String(options.exact)}`);
        return locator(`${selector}:text`);
      },
      waitFor: async (options) => actions.push(
        `wait:${selector}:${options.state}:${options.timeout}`
      )
    });

    await waitForControlledPromptProjection({
      locator,
      getByLabel: (label) => {
        actions.push(`label:${label}`);
        return locator(`label:${label}`);
      }
    });

    expect(actions).toEqual([
      "filter:[data-testid=\"conversation-row\"]:Keep the controlled Pi runtime active.",
      "wait:[data-testid=\"conversation-row\"]:filtered:visible:10000",
      "label:Pi conversation",
      "text:label:Pi conversation:Keep the controlled Pi runtime active.:true",
      "wait:label:Pi conversation:text:visible:10000"
    ]);

    const source = await readFile(
      join(repositoryRoot, "eng/packaging/windows-installed-application-lifecycle.mjs"),
      "utf8"
    );
    const promptStarted = source.indexOf("await startControlledPrompt(window)");
    const projectionReady = source.indexOf("await waitForControlledPromptProjection(window)");
    const childObserved = source.indexOf("childPid = await readPositiveProcessId(childPidPath)");
    expect(promptStarted).toBeGreaterThan(-1);
    expect(projectionReady).toBeGreaterThan(promptStarted);
    expect(childObserved).toBeGreaterThan(projectionReady);
  });

  it("passes the controlled child PID path to the post-upgrade launch", async () => {
    const source = await readFile(
      join(repositoryRoot, "eng/packaging/verify-windows-installer-lifecycle.mjs"),
      "utf8"
    );
    const secondLaunchStart = source.indexOf("const secondLaunch = await launchInstalledApplication({");
    const secondLaunchEnd = source.indexOf("assertRuntimeVersion(secondLaunch", secondLaunchStart);
    const secondLaunch = source.slice(secondLaunchStart, secondLaunchEnd);

    expect(secondLaunchStart).toBeGreaterThan(-1);
    expect(secondLaunchEnd).toBeGreaterThan(secondLaunchStart);
    expect(secondLaunch).toContain("activeControlledOperation: Boolean(baseline)");
    expect(secondLaunch).toContain("childPidPath,");
  });

  it("summarizes controlled shutdown lifecycle entries without exposing raw contents", async () => {
    const root = await createTemporaryDirectory();
    const lifecyclePath = join(root, "controlled-lifecycle.txt");
    await writeFile(lifecyclePath, "shutdown:quit\nshutdown:switch\n", "utf8");

    await expect(inspectInstalledShutdownLifecycle(lifecyclePath)).resolves.toEqual({
      available: true,
      entryCount: 2,
      otherEntryCount: 1,
      quitEntryCount: 1
    });
    await expect(inspectInstalledShutdownLifecycle(join(root, "missing.txt"))).resolves.toEqual({
      available: false,
      entryCount: 0,
      otherEntryCount: 0,
      quitEntryCount: 0
    });
  });

  it("accepts only an older exact Windows x64 installer as the upgrade baseline", () => {
    expect(resolveUpgradeBaselineInstaller(
      "C:\\release\\Pi-67-Desktop-0.1.0-alpha.2-win-x64.exe",
      "0.1.0-alpha.3"
    )).toMatchObject({ version: "0.1.0-alpha.2" });
    expect(resolveUpgradeBaselineInstaller(
      "C:\\release\\Pi-67-Desktop-0.1.0-alpha.1-win-x64-unsigned-preview.exe",
      "0.1.0-alpha.3"
    )).toMatchObject({ version: "0.1.0-alpha.1" });
    expect(() => resolveUpgradeBaselineInstaller(
      "C:\\release\\Pi-67-Desktop-0.1.0-alpha.3-win-x64.exe",
      "0.1.0-alpha.3"
    )).toThrow("must be an older");
    expect(() => resolveUpgradeBaselineInstaller("C:\\release\\other.exe", "0.1.0-alpha.3"))
      .toThrow("must be an older");
  });

  it("requires a canonical expected Publisher when signed lifecycle verification is enabled", () => {
    expect(resolveExpectedLifecycleSigner(undefined)).toBeUndefined();
    expect(resolveExpectedLifecycleSigner("ab".repeat(20))).toBe("AB".repeat(20));
    expect(() => resolveExpectedLifecycleSigner("not-a-thumbprint"))
      .toThrow("40 hexadecimal");
  });

  it("requires non-empty user data after uninstall", async () => {
    const root = await createTemporaryDirectory();
    const userData = join(root, "user-data");
    await mkdir(userData);
    await expect(assertPreservedUserData(userData)).rejects.toThrow("removed or emptied");
    await writeFile(join(userData, "Local State"), "{}", "utf8");
    await expect(assertPreservedUserData(userData)).resolves.toEqual(["Local State"]);
  });

  it("keeps the installer per-user and preserves application data on uninstall", async () => {
    const builder = await readFile(join(repositoryRoot, "electron-builder.yml"), "utf8");
    expect(builder).toMatch(/nsis:[\s\S]*?oneClick:\s*false/u);
    expect(builder).toMatch(/nsis:[\s\S]*?perMachine:\s*false/u);
    expect(builder).toMatch(/nsis:[\s\S]*?allowToChangeInstallationDirectory:\s*true/u);
    expect(builder).toMatch(/nsis:[\s\S]*?include:\s*eng\/packaging\/installer\.nsh/u);
    expect(builder).toMatch(/nsis:[\s\S]*?deleteAppDataOnUninstall:\s*false/u);
  });

  it("guards assisted current-user destinations before extracting application files", async () => {
    const guard = await readFile(join(repositoryRoot, "eng/packaging/installer.nsh"), "utf8");

    expect(guard).toMatch(/!macro customPageAfterChangeDir[\s\S]*?Page custom Pi67InstallDirectoryGuardPre Pi67InstallDirectoryGuardLeave/u);
    expect(guard).toMatch(/Function Pi67InstallDirectoryGuardPre[\s\S]*?Call instFilesPre[\s\S]*?Call Pi67CheckInstallDirectory/u);
    expect(guard).toMatch(/\$installMode == "CurrentUser"[\s\S]*?PathIsPrefixW\(w "\$PROGRAMFILES"/u);
    expect(guard).toMatch(/PathIsPrefixW\(w "\$WINDIR"/u);
    expect(guard).toMatch(/GetTempFileNameW\(w "\$INSTDIR"/u);
    expect(guard).toMatch(/Function Pi67InstallDirectoryGuardLeave\s+Abort\s+FunctionEnd/u);
  });

  it("repairs the Desktop shortcut against the updated executable", async () => {
    const installer = await readFile(join(repositoryRoot, "eng/packaging/installer.nsh"), "utf8");

    expect(installer).not.toContain("Pi67UpdateDesktopShortcutExisted");
    expect(installer).toMatch(/!macro customInstall\s+\$\{If\} \$\{isUpdated\}[\s\S]*?\$\{FileExists\} "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}"[\s\S]*?Delete "\$DESKTOP\\\$\{SHORTCUT_NAME\}\.lnk"[\s\S]*?CreateShortCut "\$DESKTOP\\\$\{SHORTCUT_NAME\}\.lnk" "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}"/u);
    expect(installer).not.toMatch(/CreateShortCut[^\n]+"\$appExe"/u);
    expect(installer).toContain('Abort "Updated Desktop shortcut could not be created."');
    expect(installer).toMatch(/WinShell::SetLnkAUMI[\s\S]*?Shell32::SHChangeNotify/u);
  });

  it("preserves dual-resolver shortcut evidence before target certification", async () => {
    const processSource = await readFile(
      join(repositoryRoot, "eng/packaging/windows-installer-process.mjs"),
      "utf8"
    );

    expect(processSource).toContain('"desktop-shortcut-observed.lnk"');
    expect(processSource).toContain('"desktop-shortcut-inspection.json"');
    expect(processSource).toContain("resolveWindowsShortcutWithWScript(shortcutPath)");
    expect(processSource).toContain("resolveWindowsShortcutWithWScript(preservedShortcutPath)");
    expect(processSource).toContain("resolveWindowsShortcutWithShellApplication(shortcutPath)");
    expect(processSource).toContain("resolveWindowsShortcutWithShellApplication(preservedShortcutPath)");
  });

  it("waits for a path to become present or absent", async () => {
    const root = await createTemporaryDirectory();
    const target = join(root, "artifact.exe");
    setTimeout(() => {
      void writeFile(target, "fixture", "utf8");
    }, 20);
    await expect(waitForPathState(target, true, 1_000)).resolves.toBeUndefined();
    setTimeout(() => {
      void rm(target, { force: true });
    }, 20);
    await expect(waitForPathState(target, false, 1_000)).resolves.toBeUndefined();
  });
});

async function createTemporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "pi67-installer-contract-"));
  temporaryDirectories.push(path);
  return path;
}
