import type {
  SessionCatalogChangedEvent,
  SessionCatalogChangedReason,
  SessionCatalogPage,
  SessionCatalogQuery,
  SessionCatalogStatus,
  WorkspaceMessageSearchResult
} from "@pi67/domain";
import type { SessionCatalogDiscoveryResult } from "./session-catalog-projection.js";
import type { SessionCatalogOrganizationMutation } from "./session-catalog-record-enricher.js";
import type { AutomaticTitleReader } from "./session-automatic-title.js";
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
  searchContent(
    workspaceId: string,
    query: string,
    context: SessionCatalogContext,
    signal?: AbortSignal
  ): Promise<WorkspaceMessageSearchResult>;
  status(): SessionCatalogStatus;
  reconcile(context: SessionCatalogContext, reason?: SessionCatalogChangedReason): Promise<void>;
  upsert(
    record: SessionCatalogRecord,
    context: SessionCatalogContext,
    reason: Extract<SessionCatalogChangedReason, "session-created" | "session-updated" | "session-imported">
  ): Promise<void>;
  organize(
    path: string,
    mutation: SessionCatalogOrganizationMutation,
    context: SessionCatalogContext
  ): Promise<number>;
  reorderPinned(paths: readonly string[], context: SessionCatalogContext): Promise<number>;
  dispose(): Promise<void>;
}

export interface CreateSessionCatalogOptions {
  directory?: string;
  storageRoot?: string;
  onChanged?: (event: SessionCatalogChangedEvent) => void;
  openSqlite?: OpenSqliteSessionCatalog;
  automaticTitleReader?: AutomaticTitleReader;
  now?: () => number;
}
