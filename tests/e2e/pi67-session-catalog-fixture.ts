import type { Page } from "@playwright/test";
import { normalizedSessionCatalogOptions } from "./pi67-session-catalog-model-fixture.js";
import type {
  SessionCatalogDegradedReason,
  SessionCatalogFixtureOptions,
  SessionCatalogFixturePatch,
  SessionCatalogRequestRecord
} from "./pi67-session-catalog-model-fixture.js";
export {
  MOCK_SESSION_CATALOG_STATUS,
  mockSessionCatalogPage
} from "./pi67-session-catalog-model-fixture.js";
export type {
  FixtureSessionCatalogStatus,
  FixtureSessionSummary,
  SessionCatalogFixtureOptions,
  SessionCatalogFixturePatch,
  SessionCatalogRequestRecord
} from "./pi67-session-catalog-model-fixture.js";

/**
 * Replaces only the Session Catalog request handler installed by the shared
 * Renderer fixture. The rest of the MessagePort protocol remains authoritative.
 */
export async function installSessionCatalogFixture(
  page: Page,
  options: SessionCatalogFixtureOptions = {}
): Promise<void> {
  const initial = normalizedSessionCatalogOptions(options);
  await page.evaluate((fixture) => {
    type CatalogCursor = {
      revision: number;
      queryKey: string;
      pinnedAt?: number;
      archivedAt?: number;
      modifiedAt: number;
      path: string;
    };
    const fixtureQueryKey = "0".repeat(64);
    type CatalogItem = {
      id: string;
      path: string;
      cwd: string;
      name: string;
      nameSource?: "explicit" | "latest-user" | "fallback";
      pinnedAt?: number;
      archivedAt?: number;
      modifiedAt: number;
      messageCount: number;
      parentSessionPath?: string;
    };
    type CatalogPatch = Omit<SessionCatalogFixtureOptions, "items"> & { items?: CatalogItem[] };
    type CatalogRequest = {
      scope?: string;
      view?: "active" | "archived";
      search?: string;
      cursor?: CatalogCursor;
      limit?: number;
      refresh?: boolean;
    };
    type CatalogFixtureState = Required<Omit<CatalogPatch, "reconciledAt" | "degradedReason">> & {
      reconciledAt?: number;
      degradedReason?: SessionCatalogDegradedReason;
      requests: Array<{ hostEpoch: number; payload: CatalogRequest }>;
      staleCursorResponses: number;
      pendingRefresh?: CatalogPatch;
      originalAttachHost?: (hostEpoch: number) => void;
    };
    type AgentState = {
      activePort?: MessagePort;
      appInstanceId: string;
      hostEpoch: number;
      sequence: number;
      sessionGeneration: number;
      taskToolMode: "ask" | "auto" | "yolo";
      snapshot: Record<string, unknown>;
      workspaceChanges: Record<string, unknown>;
      extensionCatalog: Record<string, unknown>;
      commands: Array<{ type: string; payload: unknown; hostEpoch: number }>;
      attachHost(hostEpoch: number): void;
      emit(event: { type: string; payload: unknown }, options?: { sequence?: number }): void;
    };
    type TestWindow = Window & typeof globalThis & {
      __pi67TestAgent: AgentState;
      __pi67SessionCatalogTest?: CatalogFixtureState;
    };

    const testWindow = window as TestWindow;
    const agent = testWindow.__pi67TestAgent;
    const catalog: CatalogFixtureState = {
      items: fixture.items,
      revision: fixture.revision,
      source: fixture.source,
      state: fixture.state,
      rebuilding: fixture.rebuilding,
      ...(fixture.degradedReason === undefined ? {} : { degradedReason: fixture.degradedReason }),
      ...(fixture.reconciledAt === undefined ? {} : { reconciledAt: fixture.reconciledAt }),
      incomplete: fixture.incomplete,
      skippedCount: fixture.skippedCount,
      requests: [],
      staleCursorResponses: 0
    };
    testWindow.__pi67SessionCatalogTest = catalog;

    const installPortHandler = (port: MessagePort | undefined) => {
      if (!port) return;
      const originalHandler = port.onmessage?.bind(port);
      port.onmessage = (event: MessageEvent<unknown>) => {
        const envelope = event.data as {
          kind?: string;
          requestId?: string;
          hostEpoch?: number;
          context?: Record<string, unknown>;
          type?: string;
          payload?: CatalogRequest;
        };
        const isCatalogQuery = envelope.type === "session.catalog.query";
        const isProjectionResync = envelope.type === "projection.resync";
        if (
          envelope.kind !== "request"
          || (!isCatalogQuery && !isProjectionResync)
          || !envelope.requestId
          || envelope.hostEpoch !== agent.hostEpoch
          || !envelope.context
        ) {
          originalHandler?.(event);
          return;
        }

        const payload = envelope.payload ?? {};
        const commandType = isProjectionResync ? "projection.resync" : "session.catalog.query";
        agent.commands.push({ type: commandType, payload: structuredClone(payload), hostEpoch: agent.hostEpoch });
        if (isProjectionResync) {
          port.postMessage({
            protocolVersion: 3,
            kind: "response",
            requestId: envelope.requestId,
            hostEpoch: agent.hostEpoch,
            context: envelope.context,
            type: envelope.type,
            ok: true,
            result: {
              snapshot: agent.snapshot,
              changes: agent.workspaceChanges,
              extensionCatalog: agent.extensionCatalog,
              sessionCatalogStatus: catalogStatus(catalog),
              eventSequence: agent.sequence,
              hostEpoch: agent.hostEpoch,
              sessionGeneration: agent.sessionGeneration,
              taskToolMode: agent.taskToolMode
            }
          });
          return;
        }

        const record = { hostEpoch: agent.hostEpoch, payload: structuredClone(payload) };
        catalog.requests.push(record);

        if (payload.refresh === true && catalog.pendingRefresh) {
          applyPatch(catalog, catalog.pendingRefresh);
          delete catalog.pendingRefresh;
        }

        const cursorIsStale = payload.cursor !== undefined && (
          payload.cursor.revision !== catalog.revision || catalog.staleCursorResponses > 0
        );
        if (cursorIsStale) {
          if (catalog.staleCursorResponses > 0) catalog.staleCursorResponses -= 1;
          port.postMessage({
            protocolVersion: 3,
            kind: "response",
            requestId: envelope.requestId,
            hostEpoch: agent.hostEpoch,
            context: envelope.context,
            type: envelope.type,
            ok: false,
            error: {
              code: "STALE_SESSION_CATALOG",
              message: "Session Catalog cursor is stale.",
              recoverable: true
            }
          });
          return;
        }

        port.postMessage({
          protocolVersion: 3,
          kind: "response",
          requestId: envelope.requestId,
          hostEpoch: agent.hostEpoch,
          context: envelope.context,
          type: envelope.type,
          ok: true,
          result: queryCatalog(catalog, payload)
        });
      };
      port.start();
    };

    const originalAttachHost = agent.attachHost.bind(agent);
    catalog.originalAttachHost = originalAttachHost;
    agent.attachHost = (hostEpoch: number) => {
      originalAttachHost(hostEpoch);
      installPortHandler(agent.activePort);
    };
    installPortHandler(agent.activePort);

    function applyPatch(target: CatalogFixtureState, patch: CatalogPatch): void {
      if (patch.items !== undefined) target.items = patch.items;
      if (patch.revision !== undefined) target.revision = patch.revision;
      if (patch.source !== undefined) target.source = patch.source;
      if (patch.state !== undefined) target.state = patch.state;
      if (patch.rebuilding !== undefined) target.rebuilding = patch.rebuilding;
      if (patch.degradedReason !== undefined) target.degradedReason = patch.degradedReason;
      if (patch.reconciledAt !== undefined) target.reconciledAt = patch.reconciledAt;
      if (patch.incomplete !== undefined) target.incomplete = patch.incomplete;
      if (patch.skippedCount !== undefined) target.skippedCount = patch.skippedCount;
    }

    function queryCatalog(target: CatalogFixtureState, request: CatalogRequest) {
      const search = request.search?.normalize("NFKC").trim().toLocaleLowerCase() ?? "";
      const view = request.view ?? "active";
      const filtered = target.items
        .filter((item) => view === "archived" ? item.archivedAt !== undefined : item.archivedAt === undefined)
        .filter((item) => !search || `${item.name}\n${item.cwd}\n${item.path}\n${item.id}`
          .normalize("NFKC")
          .toLocaleLowerCase()
          .includes(search))
        .map((item) => ({ ...item, nameSource: item.nameSource ?? "explicit" as const }))
        .sort((left, right) => view === "archived"
          ? (right.archivedAt ?? 0) - (left.archivedAt ?? 0)
            || right.modifiedAt - left.modifiedAt
            || right.path.localeCompare(left.path)
          : (right.pinnedAt ?? -1) - (left.pinnedAt ?? -1)
            || right.modifiedAt - left.modifiedAt
            || right.path.localeCompare(left.path));
      const limit = Math.min(200, Math.max(1, Math.trunc(request.limit ?? 50)));
      const start = cursorStart(filtered, request.cursor);
      const items = filtered.slice(start, start + limit);
      const hasMore = start + items.length < filtered.length;
      const last = items.at(-1);
      return {
        items,
        total: filtered.length,
        hasMore,
        ...(hasMore && last ? {
          nextCursor: {
            revision: target.revision,
            queryKey: fixtureQueryKey,
            ...(last.pinnedAt === undefined ? {} : { pinnedAt: last.pinnedAt }),
            ...(last.archivedAt === undefined ? {} : { archivedAt: last.archivedAt }),
            modifiedAt: last.modifiedAt,
            path: last.path
          }
        } : {}),
        revision: target.revision,
        itemCount: target.items.length,
        source: target.source,
        state: target.state,
        rebuilding: target.rebuilding,
        ...(target.degradedReason === undefined ? {} : { degradedReason: target.degradedReason }),
        ...(target.reconciledAt === undefined ? {} : { reconciledAt: target.reconciledAt }),
        incomplete: target.incomplete,
        skippedCount: target.skippedCount
      };
    }

    function catalogStatus(target: CatalogFixtureState) {
      return {
        revision: target.revision,
        itemCount: target.items.length,
        source: target.source,
        state: target.state,
        rebuilding: target.rebuilding,
        ...(target.degradedReason === undefined ? {} : { degradedReason: target.degradedReason }),
        ...(target.reconciledAt === undefined ? {} : { reconciledAt: target.reconciledAt }),
        incomplete: target.incomplete,
        skippedCount: target.skippedCount
      };
    }

    function cursorStart(items: CatalogItem[], cursor: CatalogCursor | undefined): number {
      if (!cursor) return 0;
      const exact = items.findIndex((item) => item.modifiedAt === cursor.modifiedAt && item.path === cursor.path);
      if (exact >= 0) return exact + 1;
      const next = items.findIndex((item) => (
        item.modifiedAt < cursor.modifiedAt
        || (item.modifiedAt === cursor.modifiedAt && item.path.localeCompare(cursor.path) > 0)
      ));
      return next < 0 ? items.length : next;
    }
  }, initial);
}

export async function updateSessionCatalogFixture(page: Page, patch: SessionCatalogFixturePatch): Promise<void> {
  await page.evaluate((value) => {
    const catalog = (window as unknown as {
      __pi67SessionCatalogTest: Record<string, unknown>;
    }).__pi67SessionCatalogTest;
    for (const [key, next] of Object.entries(value)) catalog[key] = next;
  }, patch);
}

export async function queueSessionCatalogRefresh(page: Page, patch: SessionCatalogFixturePatch): Promise<void> {
  await page.evaluate((value) => {
    (window as unknown as {
      __pi67SessionCatalogTest: { pendingRefresh?: SessionCatalogFixturePatch };
    }).__pi67SessionCatalogTest.pendingRefresh = value;
  }, patch);
}

export async function armStaleSessionCatalogCursor(page: Page, count = 1): Promise<void> {
  await page.evaluate((value) => {
    (window as unknown as {
      __pi67SessionCatalogTest: { staleCursorResponses: number };
    }).__pi67SessionCatalogTest.staleCursorResponses = value;
  }, count);
}

export async function clearSessionCatalogRequests(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as {
      __pi67SessionCatalogTest: { requests: SessionCatalogRequestRecord[] };
    }).__pi67SessionCatalogTest.requests = [];
  });
}

export async function sessionCatalogRequests(page: Page): Promise<SessionCatalogRequestRecord[]> {
  return page.evaluate(() => structuredClone((window as unknown as {
    __pi67SessionCatalogTest: { requests: SessionCatalogRequestRecord[] };
  }).__pi67SessionCatalogTest.requests));
}

export async function emitSessionCatalogChanged(
  page: Page,
  revision: number,
  reason: "reconciled" | "session-created" | "session-updated" | "session-imported" | "source-changed" = "reconciled"
): Promise<void> {
  await page.evaluate(({ nextRevision, changeReason }) => {
    const agent = (window as unknown as {
      __pi67TestAgent: {
        activePort?: MessagePort;
        hostEpoch: number;
        sequence: number;
        workspaceId: string;
      };
    }).__pi67TestAgent;
    agent.sequence += 1;
    agent.activePort?.postMessage({
      protocolVersion: 3,
      kind: "event",
      hostEpoch: agent.hostEpoch,
      sequence: agent.sequence,
      context: { scope: "workspace", workspaceId: agent.workspaceId },
      type: "session.catalog.changed",
      payload: { revision: nextRevision, reason: changeReason }
    });
  }, { nextRevision: revision, changeReason: reason });
}

export async function emitSessionCatalogSequenceGap(page: Page): Promise<void> {
  await page.evaluate(() => {
    const agent = (window as unknown as {
      __pi67TestAgent: {
        sequence: number;
        emit(event: { type: string; payload: unknown }, options: { sequence: number }): void;
      };
    }).__pi67TestAgent;
    agent.emit({
      type: "resource.changed",
      payload: { reason: "session-catalog-resync-fixture" }
    }, { sequence: agent.sequence + 2 });
  });
}
