import type {
  SessionCatalogChangedEvent,
  SessionCatalogChangedReason,
  SessionCatalogPage,
  SessionCatalogQuery,
  SessionCatalogStatus
} from "@pi67/domain";
import type { SessionCatalogDiscoveryResult } from "./session-catalog-projection.js";
import type {
  OpenSqliteSessionCatalog,
  SessionCatalogRecord
} from "./sqlite-session-catalog.js";

export interface SessionCatalogContext {
  sourceKey: string;
  workspaceCwd: string;
  discover(): Promise<SessionCatalogDiscoveryResult>;
}

export interface SessionCatalog {
  query(query: SessionCatalogQuery, context: SessionCatalogContext): Promise<SessionCatalogPage>;
  status(): SessionCatalogStatus;
  reconcile(context: SessionCatalogContext, reason?: SessionCatalogChangedReason): Promise<void>;
  upsert(
    record: SessionCatalogRecord,
    context: SessionCatalogContext,
    reason: Extract<SessionCatalogChangedReason, "session-created" | "session-updated" | "session-imported">
  ): Promise<void>;
  organize(
    path: string,
    mutation: { kind: "pin" | "archive"; value: boolean },
    context: SessionCatalogContext
  ): Promise<number>;
  dispose(): Promise<void>;
}

export interface CreateSessionCatalogOptions {
  directory?: string;
  storageRoot?: string;
  onChanged?: (event: SessionCatalogChangedEvent) => void;
  openSqlite?: OpenSqliteSessionCatalog;
  now?: () => number;
}
