const ALLOWED_PACKAGING_BASENAMES = new Set([
  "controlled-shutdown-fixture.ts",
  "controlled-shutdown-fixture.test.mjs",
  "packaged-electron-fixture.mjs",
  "packaged-electron-smoke-scenarios.mjs",
  "verify-windows-installer-lifecycle.mjs",
  "verify-windows-installer-lifecycle.test.mjs",
  "windows-artifact-identity.mjs",
  "windows-artifact-identity.test.mjs",
  "windows-installed-application-lifecycle.mjs",
  "windows-installer-identity.mjs",
  "windows-real-user-lifecycle.mjs",
  "windows-real-user-lifecycle.test.mjs"
]);

export function isWindowsInstallerVerifierProductPath(path) {
  if (!path.startsWith("eng/packaging/")) return false;
  return ALLOWED_PACKAGING_BASENAMES.has(path.slice("eng/packaging/".length));
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
