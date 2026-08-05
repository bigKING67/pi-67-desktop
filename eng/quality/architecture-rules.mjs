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

export function protocolDocumentationViolations(protocolSource, documentationSource) {
  const sourceMatch = protocolSource.match(
    /export const PROTOCOL_VERSION\s*=\s*(\d+)\s+as const;/u
  );
  if (!sourceMatch?.[1]) {
    return ["packages/protocol/src/protocol-version.ts: cannot resolve PROTOCOL_VERSION"];
  }
  const documentationMatch = documentationSource.match(
    /所有 envelope 使用 `protocolVersion:\s*(\d+)`/u
  );
  if (!documentationMatch?.[1]) {
    return [
      "docs/architecture/processes-and-protocol.md: missing the canonical protocolVersion declaration"
    ];
  }
  return documentationMatch[1] === sourceMatch[1]
    ? []
    : [
        "docs/architecture/processes-and-protocol.md: "
          + `protocolVersion ${documentationMatch[1]} does not match source ${sourceMatch[1]}`
      ];
}
