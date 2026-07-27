const SESSION_INSTALLATION_OWNER = "apps/renderer/src/app/renderer-session-installation.ts";
const SESSION_INSTALLATION_TEST_SUPPORT = "apps/renderer/src/session/session-projection-test-support.ts";
const SESSION_REPLACEMENT_CALL = /\.\s*(beginSnapshotReplacement|commitSnapshotReplacement)\s*\(/gu;

export function rendererSessionInstallationViolations(path, source) {
  if (
    !path.startsWith("apps/renderer/src/")
    || path === SESSION_INSTALLATION_OWNER
    || path === SESSION_INSTALLATION_TEST_SUPPORT
  ) return [];

  return [...source.matchAll(SESSION_REPLACEMENT_CALL)].map((match) => (
    `${path}: ${match[1]} is owned by ${SESSION_INSTALLATION_OWNER}`
  ));
}
