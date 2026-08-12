import { dirname, isAbsolute, relative, resolve } from "node:path";
import { resolveExistingSessionFileIdentity } from "../../packages/pi-runtime/src/session-path-identity.ts";
import { fingerprintSessionIdentity } from "./windows-installer-identity.mjs";

export async function inspectRealUserSessionCatalogDiscovery({
  agentDir,
  expectedSessionIdentity,
  sessionPath,
  workspace
}, runtime) {
  const {
    createSessionCatalogContext,
    normalizeSessionCatalogCwd
  } = runtime ?? await import("../../packages/pi-runtime/dist/index.mjs");
  const context = createSessionCatalogContext({ agentDir, workspaceCwd: workspace });
  const expectedFileIdentity = readSessionFileIdentity(expectedSessionIdentity);
  const currentFileIdentity = sessionPath
    ? await resolveExistingSessionFileIdentity(sessionPath).catch(() => undefined)
    : undefined;
  const base = {
    currentFileIdentityFingerprint: fingerprintSessionIdentity(currentFileIdentity),
    expectedIdentityFileFingerprint: fingerprintSessionIdentity(expectedFileIdentity),
    sessionDirectoryDepth: sessionPath ? containedDirectoryDepth(agentDir, sessionPath) : null,
    sessionPathLength: sessionPath?.length ?? 0,
    sourceKeyFingerprint: fingerprintSessionIdentity(context.sourceKey)
  };
  let discovered;
  try {
    discovered = await context.discover();
  } catch (error) {
    return {
      ...base,
      discoveryErrorCode: boundedErrorCode(error),
      discoveryErrorName: error instanceof Error ? error.name.slice(0, 80) : "NonError",
      discoveryState: "error"
    };
  }
  const workspaceKey = normalizeSessionCatalogCwd(workspace);
  const expectedRecord = expectedFileIdentity
    ? discovered.records.find((record) => record.fileIdentity === expectedFileIdentity)
    : undefined;
  const currentRecord = currentFileIdentity
    ? discovered.records.find((record) => record.fileIdentity === currentFileIdentity)
    : undefined;
  const expectedPathRecordPresent = sessionPath
    ? discovered.records.some((record) => sameSessionPath(record.path, sessionPath))
    : false;
  return {
    ...base,
    currentPhysicalRecordPresent: currentRecord !== undefined,
    currentRecordWorkspaceMatch: currentRecord ? currentRecord.cwdKey === workspaceKey : null,
    discoveryState: "complete",
    expectedPathRecordPresent,
    expectedPhysicalRecordPresent: expectedRecord !== undefined,
    expectedRecordWorkspaceMatch: expectedRecord ? expectedRecord.cwdKey === workspaceKey : null,
    incomplete: discovered.incomplete,
    recordCount: discovered.records.length,
    recordFileIdentityFingerprints: discovered.records.slice(0, 8)
      .map((record) => fingerprintSessionIdentity(record.fileIdentity)),
    recordWorkspaceIdentityFingerprints: discovered.records.slice(0, 8)
      .map((record) => fingerprintSessionIdentity(record.cwdKey)),
    skippedCount: discovered.skippedCount,
    workspaceIdentityFingerprint: fingerprintSessionIdentity(workspaceKey),
    workspaceMatchedRecordCount: discovered.records.filter((record) => record.cwdKey === workspaceKey).length
  };
}

function readSessionFileIdentity(identity) {
  if (typeof identity !== "string") return undefined;
  const match = /^session:[^:]+:(.+)$/su.exec(identity);
  return match?.[1];
}

function containedDirectoryDepth(agentDir, sessionPath) {
  const relativePath = relative(resolve(agentDir), resolve(sessionPath));
  if (relativePath === "" || isAbsolute(relativePath) || /^\.\.(?:[\\/]|$)/u.test(relativePath)) return null;
  const directory = dirname(relativePath);
  return directory === "." ? 0 : directory.split(/[\\/]+/u).filter(Boolean).length;
}

function boundedErrorCode(error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && /^[A-Z0-9_-]{1,64}$/u.test(code) ? code : null;
}

function sameSessionPath(left, right) {
  const resolvedLeft = resolve(left).normalize("NFC");
  const resolvedRight = resolve(right).normalize("NFC");
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}
