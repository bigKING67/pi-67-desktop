import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import {
  MAX_SESSION_CATALOG_ID_CHARS,
  MAX_SESSION_CATALOG_NAME_CHARS,
  MAX_SESSION_CATALOG_PAGE_ITEMS,
  MAX_SESSION_CATALOG_PAGE_JSON_BYTES,
  MAX_SESSION_CATALOG_PATH_CHARS,
  MAX_SESSION_CATALOG_SEARCH_CHARS,
  MAX_SESSION_FILE_IDENTITY_CHARS
} from "@pi67/domain";
import type { SessionCatalogStatus } from "@pi67/domain";
import type { SessionCatalogPageResult, SessionCatalogResultItem } from "./agent-messages.js";
import {
  APP_PROTOCOL_CONTEXT,
  commandEnvelope,
  eventEnvelope,
  isEventEnvelope,
  isRequestEnvelope,
  isResponseEnvelope,
  responseEnvelope,
  type ProtocolContext
} from "./envelope.js";
import {
  SessionCatalogPageSchema,
  SessionCatalogQuerySchema,
  SessionCatalogStatusSchema
} from "./session-catalog-schemas.js";

describe("Session Catalog protocol schemas", () => {
  const queryKey = "a".repeat(64);
  const workspaceContext: ProtocolContext = { scope: "workspace", workspaceId: "workspace-1" };

  it("accepts bounded structured queries and rejects invalid limits, cursors and unknown fields", () => {
    const boundaryQuery = {
      scope: "all",
      search: "s".repeat(MAX_SESSION_CATALOG_SEARCH_CHARS),
      cursor: {
        revision: Number.MAX_SAFE_INTEGER,
        queryKey,
        modifiedAt: Number.MAX_SAFE_INTEGER,
        path: "p".repeat(MAX_SESSION_CATALOG_PATH_CHARS)
      },
      limit: MAX_SESSION_CATALOG_PAGE_ITEMS,
      refresh: true
    };

    expect(Value.Check(SessionCatalogQuerySchema, boundaryQuery)).toBe(true);
    expect(Value.Check(SessionCatalogQuerySchema, { scope: "workspace", limit: 1 })).toBe(true);
    expect(Value.Check(SessionCatalogQuerySchema, { scope: "workspace", limit: 0 })).toBe(false);
    expect(Value.Check(SessionCatalogQuerySchema, {
      scope: "workspace",
      limit: MAX_SESSION_CATALOG_PAGE_ITEMS + 1
    })).toBe(false);
    expect(Value.Check(SessionCatalogQuerySchema, {
      scope: "workspace",
      search: "s".repeat(MAX_SESSION_CATALOG_SEARCH_CHARS + 1)
    })).toBe(false);
    expect(Value.Check(SessionCatalogQuerySchema, {
      scope: "workspace",
      cursor: { modifiedAt: 1, path: "/sessions/one.jsonl" }
    })).toBe(false);
    expect(Value.Check(SessionCatalogQuerySchema, {
      scope: "workspace",
      cursor: { revision: 1, queryKey: "A".repeat(64), modifiedAt: 1, path: "/sessions/one.jsonl" }
    })).toBe(false);
    expect(Value.Check(SessionCatalogQuerySchema, {
      scope: "workspace",
      unexpected: true
    })).toBe(false);
  });

  it("requires Workspace authority so queries do not depend on a Task Runtime", () => {
    const workspaceQuery = commandEnvelope(
      "session.catalog.query",
      { scope: "workspace", limit: 50 },
      workspaceContext,
      3
    );
    expect(isRequestEnvelope(workspaceQuery)).toBe(true);
    expect(isRequestEnvelope({ ...workspaceQuery, context: APP_PROTOCOL_CONTEXT })).toBe(false);
    expect(isRequestEnvelope({
      ...workspaceQuery,
      context: {
        scope: "task",
        workspaceId: "workspace-1",
        taskId: "task-1",
        taskGeneration: 1
      }
    })).toBe(false);
  });

  it("bounds page items and every SessionSummary field", () => {
    const boundaryItem = sessionSummary({
      fileIdentity: "f".repeat(MAX_SESSION_FILE_IDENTITY_CHARS),
      id: "i".repeat(MAX_SESSION_CATALOG_ID_CHARS),
      path: "p".repeat(MAX_SESSION_CATALOG_PATH_CHARS),
      cwd: "c".repeat(MAX_SESSION_CATALOG_PATH_CHARS),
      name: "n".repeat(MAX_SESSION_CATALOG_NAME_CHARS),
      parentSessionPath: "r".repeat(MAX_SESSION_CATALOG_PATH_CHARS)
    });
    const boundaryPage = catalogPage({
      items: Array.from({ length: MAX_SESSION_CATALOG_PAGE_ITEMS }, () => boundaryItem),
      total: MAX_SESSION_CATALOG_PAGE_ITEMS
    });

    expect(Value.Check(SessionCatalogPageSchema, boundaryPage)).toBe(true);
    expect(Value.Check(SessionCatalogPageSchema, catalogPage({
      items: Array.from({ length: MAX_SESSION_CATALOG_PAGE_ITEMS + 1 }, () => sessionSummary())
    }))).toBe(false);

    for (const item of [
      sessionSummary({ fileIdentity: "f".repeat(MAX_SESSION_FILE_IDENTITY_CHARS + 1) }),
      sessionSummary({ id: "i".repeat(MAX_SESSION_CATALOG_ID_CHARS + 1) }),
      sessionSummary({ path: "p".repeat(MAX_SESSION_CATALOG_PATH_CHARS + 1) }),
      sessionSummary({ cwd: "c".repeat(MAX_SESSION_CATALOG_PATH_CHARS + 1) }),
      sessionSummary({ name: "n".repeat(MAX_SESSION_CATALOG_NAME_CHARS + 1) }),
      sessionSummary({ parentSessionPath: "p".repeat(MAX_SESSION_CATALOG_PATH_CHARS + 1) })
    ]) {
      expect(Value.Check(SessionCatalogPageSchema, catalogPage({ items: [item] }))).toBe(false);
    }

    expect(Value.Check(SessionCatalogPageSchema, {
      ...catalogPage(),
      items: [{ ...sessionSummary(), unknown: true }]
    })).toBe(false);
    expect(Value.Check(SessionCatalogPageSchema, { ...catalogPage(), unknown: true })).toBe(false);
  });

  it("allows all-Workspace results to identify each item's Workspace", () => {
    const request = commandEnvelope(
      "session.catalog.query",
      { scope: "all" },
      workspaceContext,
      3
    );
    const result = catalogPage({
      items: [sessionSummary({ workspaceId: "workspace-2" })]
    });
    const response = responseEnvelope(request.requestId, 3, request.context, {
      ok: true,
      type: "session.catalog.query",
      result
    });
    expect(isRequestEnvelope(request)).toBe(true);
    expect(isResponseEnvelope(response)).toBe(true);
    expect(response.ok && response.result.items[0]?.workspaceId).toBe("workspace-2");
    expect(isResponseEnvelope({
      ...response,
      result: catalogPage({ items: [sessionSummary({ workspaceId: "" })] })
    })).toBe(false);
    expect(isResponseEnvelope({
      ...response,
      result: catalogPage({ items: [sessionSummary({ workspaceId: "w".repeat(513) })] })
    })).toBe(false);
  });

  it("requires a response cursor to stay bound to its catalog revision", () => {
    const validPage = catalogPage({
      revision: 7,
      hasMore: true,
      nextCursor: { revision: 7, queryKey, modifiedAt: 1_700_000_000_000, path: "/sessions/one.jsonl" }
    });
    const response = responseEnvelope("request-1", 3, workspaceContext, {
      ok: true,
      type: "session.catalog.query",
      result: validPage
    });
    expect(isResponseEnvelope(response)).toBe(true);
    expect(isResponseEnvelope({
      ...response,
      result: {
        ...validPage,
        nextCursor: { ...validPage.nextCursor!, revision: 6 }
      }
    })).toBe(false);
  });

  it("keeps a valid page below its dedicated JSON projection budget", () => {
    const oversizedPage = catalogPage({
      items: Array.from({ length: 24 }, (_, index) => sessionSummary({
        id: `session-${index}`,
        path: "p".repeat(MAX_SESSION_CATALOG_PATH_CHARS),
        cwd: "c".repeat(MAX_SESSION_CATALOG_PATH_CHARS)
      })),
      total: 24,
      itemCount: 24
    });
    expect(JSON.stringify(oversizedPage).length).toBeGreaterThan(MAX_SESSION_CATALOG_PAGE_JSON_BYTES);
    expect(isResponseEnvelope(responseEnvelope("request-oversized", 3, workspaceContext, {
      ok: true,
      type: "session.catalog.query",
      result: oversizedPage
    }))).toBe(false);
  });

  it("validates stale catalog errors as a structured recoverable response", () => {
    const stale = responseEnvelope("request-1", 3, workspaceContext, {
      ok: false,
      type: "session.catalog.query",
      error: {
        code: "STALE_SESSION_CATALOG",
        message: "Session Catalog cursor revision is stale.",
        recoverable: true,
        details: { cursorRevision: 6, currentRevision: 7 }
      }
    });
    expect(isResponseEnvelope(stale)).toBe(true);
    if (stale.ok) throw new Error("Expected a stale Session Catalog error response.");
    expect(isResponseEnvelope({
      ...stale,
      error: { ...stale.error, details: { currentRevision: { nested: 7 } } }
    })).toBe(false);
  });

  it("keeps change events metadata-only", () => {
    for (const reason of [
      "reconciled",
      "session-created",
      "session-updated",
      "session-imported",
      "conversation-organized",
      "automatic-title",
      "source-changed"
    ] as const) {
      expect(isEventEnvelope(eventEnvelope("session.catalog.changed", {
        revision: 8,
        reason
      }, { hostEpoch: 3, sequence: 1, context: workspaceContext }))).toBe(true);
    }

    const changed = eventEnvelope("session.catalog.changed", {
      revision: 8,
      reason: "reconciled"
    }, { hostEpoch: 3, sequence: 1, context: workspaceContext });
    expect(isEventEnvelope({
      ...changed,
      payload: { ...changed.payload, items: [sessionSummary()] }
    })).toBe(false);
    expect(isEventEnvelope({ ...changed, context: APP_PROTOCOL_CONTEXT })).toBe(false);
    expect(isEventEnvelope(eventEnvelope("session.catalog.changed", {
      revision: 8,
      reason: "reconciled"
    }, {
      hostEpoch: 3,
      sequence: 1,
      context: {
        scope: "task",
        workspaceId: "workspace-1",
        taskId: "task-1",
        taskGeneration: 1
      },
      taskSequence: 1
    }))).toBe(false);
  });

  it("validates status independently for projection resync", () => {
    expect(Value.Check(SessionCatalogStatusSchema, catalogStatus())).toBe(true);
    expect(Value.Check(SessionCatalogStatusSchema, {
      ...catalogStatus(),
      source: "sdk-fallback",
      state: "fallback",
      degradedReason: "storage-prepare"
    })).toBe(true);
    expect(Value.Check(SessionCatalogStatusSchema, {
      ...catalogStatus(),
      degradedReason: "raw-user-path"
    })).toBe(false);
    expect(Value.Check(SessionCatalogStatusSchema, { ...catalogStatus(), itemCount: -1 })).toBe(false);
    expect(Value.Check(SessionCatalogStatusSchema, { ...catalogStatus(), total: 1 })).toBe(false);
  });
});

function sessionSummary(overrides: Partial<SessionCatalogResultItem> = {}): SessionCatalogResultItem {
  return {
    fileIdentity: "session-file-v1\0fixture-1",
    id: "session-1",
    path: "/sessions/one.jsonl",
    cwd: "/workspace",
    name: "First session",
    nameSource: "explicit",
    modifiedAt: 1_700_000_000_000,
    messageCount: 12,
    ...overrides
  } as SessionCatalogResultItem;
}

function catalogStatus(): SessionCatalogStatus {
  return {
    revision: 7,
    itemCount: 1,
    source: "sqlite",
    state: "ready",
    rebuilding: false,
    reconciledAt: 1_700_000_000_000,
    incomplete: false,
    skippedCount: 0
  };
}

function catalogPage(overrides: Partial<SessionCatalogPageResult> = {}): SessionCatalogPageResult {
  return {
    items: [sessionSummary()],
    total: 1,
    hasMore: false,
    ...catalogStatus(),
    ...overrides
  };
}
