import { assertPackagedRuntimeAssets } from "./packaged-electron-fixture.mjs";
import { assertSameArtifactBytes } from "./windows-artifact-identity.mjs";
import {
  assertWindowsShortcutTarget,
  buildNsisUpdateArguments,
  installNsisUpdatePackage,
  stopWindowsProcessTree
} from "./windows-installer-process.mjs";
import {
  readLifecycleArtifactIdentity,
  resolveInstalledArtifact
} from "./windows-installer-identity.mjs";

export async function verifyWindowsInstallerUpdateLifecycle({
  desktopShortcutPath,
  expectedSigner,
  installDirectory,
  installerPath,
  packagedExecutableIdentity,
  phaseName,
  shortcutEvidenceDirectory
}) {
  let processId;
  const startedAt = performance.now();
  try {
    const updateResult = await installNsisUpdatePackage(installerPath, installDirectory, {
      desktopShortcutPath,
      evidenceDirectory: shortcutEvidenceDirectory
    });
    processId = updateResult.processId;
    const phase = { durationMs: round(performance.now() - startedAt), name: phaseName };
    const installedArtifact = await resolveInstalledArtifact(installDirectory);
    await assertPackagedRuntimeAssets(installedArtifact);
    const installedExecutableIdentity = await readLifecycleArtifactIdentity(
      installedArtifact.executablePath,
      expectedSigner,
      "Upgraded Windows executable"
    );
    assertSameArtifactBytes(
      installedExecutableIdentity,
      packagedExecutableIdentity,
      "Upgraded Windows executable"
    );
    const updateHandoff = {
      automaticPostInstallLaunch: true,
      arguments: buildNsisUpdateArguments("<existing-install-directory>"),
      installationSurface: updateResult.updateSurface,
      desktopShortcut: await assertWindowsShortcutTarget(
        desktopShortcutPath,
        installedArtifact.executablePath,
        { evidenceDirectory: shortcutEvidenceDirectory }
      )
    };
    return { installedArtifact, installedExecutableIdentity, phase, updateHandoff };
  } finally {
    if (processId !== undefined) await stopWindowsProcessTree(processId);
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}
