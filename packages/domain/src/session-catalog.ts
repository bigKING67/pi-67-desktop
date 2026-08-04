import type { SessionSummary } from "./session-view.js";

export type SessionCatalogScope = "workspace" | "all";
export type SessionCatalogView = "active" | "archived";

export interface ConversationOrganization {
  pinnedAt?: number;
  archivedAt?: number;
}

export interface SessionCatalogCursor {
  revision: number;
  queryKey: string;
  pinnedAt?: number;
  archivedAt?: number;
  modifiedAt: number;
  path: string;
}

export interface SessionCatalogQuery {
  scope: SessionCatalogScope;
  view?: SessionCatalogView;
  search?: string;
  cursor?: SessionCatalogCursor;
  limit?: number;
  refresh?: boolean;
}

export type SessionCatalogSource = "sqlite" | "sdk-fallback";

export type SessionCatalogState = "ready" | "rebuilding" | "fallback" | "unavailable";

export type SessionCatalogDegradedReason =
  | "busy"
  | "unavailable"
  | "runtime-load"
  | "storage-prepare"
  | "storage-inspect"
  | "database-open"
  | "database-verify"
  | "schema-prepare"
  | "recovery-prepare"
  | "recovery-open"
  | "recovery-verify"
  | "recovery-schema"
  | "runtime-query";

export interface SessionCatalogStatus {
  revision: number;
  itemCount: number;
  source: SessionCatalogSource;
  state: SessionCatalogState;
  rebuilding: boolean;
  degradedReason?: SessionCatalogDegradedReason;
  reconciledAt?: number;
  incomplete: boolean;
  skippedCount: number;
}

export interface SessionCatalogPage extends SessionCatalogStatus {
  items: SessionSummary[];
  total: number;
  hasMore: boolean;
  nextCursor?: SessionCatalogCursor;
}

export type SessionCatalogChangedReason =
  | "reconciled"
  | "session-created"
  | "session-updated"
  | "session-imported"
  | "conversation-organized"
  | "source-changed";

export interface SessionCatalogChangedEvent {
  revision: number;
  reason: SessionCatalogChangedReason;
}
