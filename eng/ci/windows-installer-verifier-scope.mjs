const ALLOWED_PACKAGING_BASENAMES = new Set([
  "controlled-shutdown-fixture.ts",
  "controlled-shutdown-fixture.test.mjs",
  "packaged-electron-fixture.mjs",
  "packaged-electron-smoke-scenarios.mjs",
  "verify-windows-packaged-input-layout.mjs",
  "verify-windows-packaged-input-layout.test.mjs",
  "verify-windows-installer-lifecycle.mjs",
  "verify-windows-installer-lifecycle.test.mjs",
  "windows-artifact-identity.mjs",
  "windows-artifact-identity.test.mjs",
  "windows-installed-application-lifecycle.mjs",
  "windows-installer-identity.mjs",
  "windows-installer-profile-authority.test.mjs",
  "windows-real-user-lifecycle.mjs",
  "windows-real-user-lifecycle.test.mjs",
  "windows-real-user-profile.mjs",
  "windows-real-user-profile.test.mjs"
]);

const ALLOWED_CI_BASENAMES = new Set([
  "classify-change-scope.test.mjs",
  "verify-windows-installer-debug-scope.mjs",
  "verify-windows-installer-debug-scope.test.mjs",
  "windows-installer-source-run.mjs",
  "windows-installer-verifier-scope.mjs"
]);

export function isWindowsInstallerVerifierProductPath(path) {
  if (path.startsWith("eng/packaging/")) {
    return ALLOWED_PACKAGING_BASENAMES.has(path.slice("eng/packaging/".length));
  }
  if (path.startsWith("eng/ci/")) {
    return ALLOWED_CI_BASENAMES.has(path.slice("eng/ci/".length));
  }
  return false;
}

function isAllowedWindowsInstallerVerifierChange(path) {
  return path.startsWith("docs/")
    || path.endsWith(".md")
    || isWindowsInstallerVerifierProductPath(path);
}

export function verifyWindowsInstallerVerifierScope(paths) {
  const rejected = paths.filter((path) => !isAllowedWindowsInstallerVerifierChange(path));
  if (rejected.length > 0) {
    throw new Error(`Windows installer artifact reuse rejected changed paths: ${rejected.join(", ")}`);
  }
}
