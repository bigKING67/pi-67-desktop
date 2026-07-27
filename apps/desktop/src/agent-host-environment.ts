import { join, resolve } from "node:path";

export interface AgentHostStoragePaths {
  readonly storageRoot: string;
  readonly capabilityProbeDirectory: string;
  readonly sessionCatalogDirectory: string;
}

export function agentHostEnvironment(
  source: NodeJS.ProcessEnv,
  storage: AgentHostStoragePaths
): NodeJS.ProcessEnv {
  assertMainOwnedStorageLayout(storage);
  return {
    ...source,
    PI67_DESKTOP: "1",
    PI_TELEMETRY: "0",
    PI67_STORAGE_ROOT: storage.storageRoot,
    PI67_CAPABILITY_PROBE_DIR: storage.capabilityProbeDirectory,
    PI67_SESSION_CATALOG_DIR: storage.sessionCatalogDirectory
  };
}

function assertMainOwnedStorageLayout(storage: AgentHostStoragePaths): void {
  const root = resolve(storage.storageRoot);
  if (
    !samePath(storage.capabilityProbeDirectory, root)
    || !samePath(storage.sessionCatalogDirectory, join(root, "projections", "session-catalog"))
  ) {
    throw new Error("Agent Host storage environment must use the Main-owned userData layout.");
  }
}

function samePath(left: string, right: string): boolean {
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLowerCase()
    : (value: string) => resolve(value);
  return normalize(left) === normalize(right);
}
