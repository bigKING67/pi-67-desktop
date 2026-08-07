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

export function runningTaskDocumentationViolations(domainSource, documents) {
  const sourceMatch = domainSource.match(
    /export const MAX_RUNNING_TASKS\s*=\s*(\d+)\s*;/u
  );
  if (!sourceMatch?.[1]) {
    return ["packages/domain/src/workbench.ts: cannot resolve MAX_RUNNING_TASKS"];
  }
  const violations = [];
  for (const document of documents) {
    const documentationMatch = document.source.match(/`MAX_RUNNING_TASKS\s*=\s*(\d+)`/u);
    if (!documentationMatch?.[1]) {
      violations.push(`${document.path}: missing the canonical MAX_RUNNING_TASKS declaration`);
      continue;
    }
    if (documentationMatch[1] !== sourceMatch[1]) {
      violations.push(
        `${document.path}: MAX_RUNNING_TASKS ${documentationMatch[1]} does not match source ${sourceMatch[1]}`
      );
    }
  }
  return violations;
}
