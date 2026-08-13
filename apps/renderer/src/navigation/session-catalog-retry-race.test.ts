import type { SessionCatalogPage, SessionSummary } from "@pi67/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import {
  cancelSessionCatalogRetries,
  queryFirstSessionCatalog
} from "./session-catalog-controller.js";
import {
  selectWorkspaceSessionCatalog,
  useSessionCatalogStore
} from "./session-catalog-store.js";

const WORKSPACE_ID = "workspace-race";
const SESSION: SessionSummary = {
  fileIdentity: "session-file-race",
  id: "session-race",
  path: "/sessions/race.jsonl",
  cwd: "/work",
  name: "Race Session",
  nameSource: "explicit",
  modifiedAt: 20,
  messageCount: 2
};

describe("Session Catalog retry races", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
    rendererWorkbenchStore.getState().reset();
  });

  afterEach(() => {
    cancelSessionCatalogRetries();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not let a duplicate startup query cancel rebuilding retries", async () => {
    const request = vi.spyOn(agentConnectionController, "request")
      .mockResolvedValueOnce(page([], { state: "rebuilding", rebuilding: true }) as never)
      .mockResolvedValueOnce(page([], { state: "rebuilding", rebuilding: true }) as never)
      .mockResolvedValueOnce(page([SESSION], { revision: 2 }) as never);

    await queryFirstSessionCatalog(WORKSPACE_ID);
    await queryFirstSessionCatalog(WORKSPACE_ID);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(request).toHaveBeenCalledTimes(3);
    expect(selectWorkspaceSessionCatalog(useSessionCatalogStore.getState(), WORKSPACE_ID)).toMatchObject({
      items: [SESSION],
      catalogState: "ready",
      rebuilding: false
    });
  });
});

function page(items: SessionSummary[], overrides: Partial<SessionCatalogPage> = {}): SessionCatalogPage {
  return {
    items,
    total: items.length,
    hasMore: false,
    revision: 1,
    itemCount: items.length,
    source: "sqlite",
    state: "ready",
    rebuilding: false,
    incomplete: false,
    skippedCount: 0,
    ...overrides
  };
}
