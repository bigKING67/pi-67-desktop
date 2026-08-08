import type {
  SessionCatalogContext,
  SessionCatalogDiscoveryResult
} from "./session-catalog.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";
import type { SessionCatalogRecord } from "./sqlite-session-catalog.js";

export function sessionCatalogContext(
  sourceKey: string,
  discover: () => Promise<SessionCatalogDiscoveryResult>,
  workspaceCwd = "/workspace"
): SessionCatalogContext {
  return { sourceKey, workspaceCwd, discover };
}

export function sessionCatalogDiscovery(records: SessionCatalogRecord[]): SessionCatalogDiscoveryResult {
  return { records, incomplete: false, skippedCount: 0 };
}

export function sessionCatalogRecord(
  index: number,
  overrides: Partial<SessionCatalogRecord> = {}
): SessionCatalogRecord {
  return {
    fileIdentity: `session-file-fixture-${index}`,
    id: `id-${index}`,
    path: `/session-${index}.jsonl`,
    cwd: "/workspace",
    cwdKey: normalizeSessionCatalogPathIdentity("/workspace"),
    explicitName: `Session ${index}`,
    modifiedAt: 10_000 - index,
    messageCount: index,
    ...overrides
  };
}
