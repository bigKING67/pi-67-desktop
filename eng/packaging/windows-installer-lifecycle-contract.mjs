export const WINDOWS_INSTALLER_PROCESS_TIMEOUT_MS = 240_000;

export function parseWindowsInstallerLifecycleArguments(arguments_) {
  if (arguments_.length === 0) return { quick: false };
  if (arguments_.length === 1 && arguments_[0] === "--quick") return { quick: true };
  throw new Error("Expected no arguments or --quick.");
}

export function resolveWindowsInstallerLifecycleContract({ baseline, quick }) {
  if (baseline && quick) {
    throw new Error("Quick Windows installer lifecycle cannot verify a cross-version upgrade baseline.");
  }
  return {
    certificationMode: quick ? "quick" : "full",
    evidenceLevel: baseline
      ? "windows-nsis-cross-version-upgrade-dual-profile-lifecycle-uninstall"
      : quick
        ? "windows-nsis-silent-install-dual-profile-lifecycle-uninstall"
        : "windows-nsis-silent-install-reinstall-dual-profile-lifecycle-uninstall",
    verifyReinstall: !quick
  };
}
