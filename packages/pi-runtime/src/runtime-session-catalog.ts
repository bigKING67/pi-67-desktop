import { stat } from "node:fs/promises";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type {
  SessionCatalogChangedReason,
  SessionCatalogPage,
  SessionCatalogQuery,
  SessionCatalogStatus
} from "@pi67/domain";
import type { AgentEvent } from "@pi67/protocol";
import { createSessionCatalog, type SessionCatalog } from "./session-catalog.js";
import { createSessionCatalogContext } from "./session-discovery.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";
import type { SessionProjectionMetadata } from "./session-projection-index.js";
import type { SessionCatalogRecord } from "./sqlite-session-catalog.js";

type UpsertReason = Extract<
  SessionCatalogChangedReason,
  "session-created" | "session-updated" | "session-imported"
>;

export interface RuntimeSessionCatalogTarget {
  emit(event: AgentEvent): void;
  getAgentDir(): string;
  getConfiguredSessionDir(): string | undefined;
  getWorkspaceCwd(): string;
  getSessionManager(): SessionManager | undefined;
  getSessionMetadata(manager: SessionManager): SessionProjectionMetadata;
}

export interface RuntimeSessionCatalog {
  query(query: SessionCatalogQuery): Promise<SessionCatalogPage>;
  status(): SessionCatalogStatus;
  upsertCurrent(reason: UpsertReason): Promise<void>;
  dispose(): Promise<void>;
}

export interface RuntimeSessionCatalogOwner {
  createBinding(target: RuntimeSessionCatalogTarget): RuntimeSessionCatalog;
  status(): SessionCatalogStatus;
  dispose(): Promise<void>;
}

export function createRuntimeSessionCatalogOwner(
  directory?: string,
  storageRoot?: string
): RuntimeSessionCatalogOwner {
  const targets = new Set<RuntimeSessionCatalogTarget>();
  const catalog = createSessionCatalog({
    ...(directory === undefined ? {} : { directory }),
    ...(storageRoot === undefined ? {} : { storageRoot }),
    onChanged: (payload) => {
      for (const target of targets) {
        target.emit({ type: "session.catalog.changed", payload });
      }
    }
  });
  let disposed = false;

  return {
    createBinding(target) {
      if (disposed) throw new Error("The Workspace Session Catalog has been disposed.");
      targets.add(target);
      let bindingDisposed = false;
      return {
        query(query) {
          if (bindingDisposed) throw new Error("The Runtime Session Catalog binding has been disposed.");
          return catalog.query(query, createContext(target));
        },
        status: () => catalog.status(),
        upsertCurrent(reason) {
          if (bindingDisposed) return Promise.resolve();
          return upsertCurrentSession(catalog, target, reason);
        },
        async dispose() {
          if (bindingDisposed) return;
          bindingDisposed = true;
          targets.delete(target);
        }
      };
    },
    status: () => catalog.status(),
    async dispose() {
      if (disposed) return;
      disposed = true;
      targets.clear();
      await catalog.dispose();
    }
  };
}

export function createRuntimeSessionCatalog(
  directory: string | undefined,
  target: RuntimeSessionCatalogTarget,
  storageRoot?: string
): RuntimeSessionCatalog {
  const owner = createRuntimeSessionCatalogOwner(directory, storageRoot);
  const binding = owner.createBinding(target);
  return {
    query: (query) => binding.query(query),
    status: () => binding.status(),
    upsertCurrent: (reason) => binding.upsertCurrent(reason),
    async dispose() {
      await binding.dispose();
      await owner.dispose();
    }
  };
}

async function upsertCurrentSession(
  catalog: SessionCatalog,
  target: RuntimeSessionCatalogTarget,
  reason: UpsertReason
): Promise<void> {
  const manager = target.getSessionManager();
  if (!manager) return;
  const record = await projectCurrentSession(manager, target.getSessionMetadata(manager));
  if (record) await catalog.upsert(record, createContext(target), reason);
}

function createContext(target: RuntimeSessionCatalogTarget) {
  const configuredSessionDir = target.getConfiguredSessionDir();
  return createSessionCatalogContext({
    agentDir: target.getAgentDir(),
    workspaceCwd: target.getWorkspaceCwd(),
    ...(configuredSessionDir === undefined ? {} : { configuredSessionDir })
  });
}

async function projectCurrentSession(
  manager: SessionManager,
  live: SessionProjectionMetadata
): Promise<SessionCatalogRecord | undefined> {
  const path = manager.getSessionFile();
  if (!path) return undefined;
  const file = await stat(path).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!file) return undefined;
  const header = manager.getHeader();
  const explicitName = manager.getSessionName()?.trim() || undefined;
  return {
    id: manager.getSessionId(),
    path,
    cwd: manager.getCwd(),
    cwdKey: normalizeSessionCatalogPathIdentity(manager.getCwd()),
    ...(explicitName === undefined ? {} : { explicitName }),
    modifiedAt: live.modifiedAt || Math.max(0, Math.trunc(file.mtimeMs)),
    messageCount: live.messageCount,
    ...(header?.parentSession === undefined ? {} : { parentSessionPath: header.parentSession })
  };
}
