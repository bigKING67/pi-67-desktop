import type { SessionCatalogPage, SessionSummary } from "@pi67/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { cancelSessionCatalogRetries } from "../navigation/session-catalog-controller.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import {
  rendererWorkbenchStore,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import {
  dismissUnconfirmedRendererSession,
  recheckUnconfirmedRendererSession
} from "./session-creation-recovery-controller.js";

describe("session creation recovery controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useTaskDraftStore.getState().dispose();
    rendererWorkbenchStore.getState().reset();
    rendererWorkbenchStore.getState().registerWorkspace(workspace());
  });

  afterEach(() => {
    cancelSessionCatalogRetries();
  });

  it("materializes only the exact resolver identity confirmed by the authoritative Catalog", async () => {
    openUnconfirmedTask();
    const created = catalogSession("session-created", 10_100);
    const tuiSession = catalogSession("session-created-by-tui", 10_101);
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "session.creation.resolve") {
        return {
          status: "materialized",
          creationId: "session-creation-unconfirmed",
          sessionId: created.id,
          sessionPath: created.path
        } as never;
      }
      if (type === "session.catalog.query") {
        return catalogPage([tuiSession, created], { revision: 2, total: 2 }) as never;
      }
      throw new Error(`Unexpected request: ${type}`);
    });

    await expect(recheckUnconfirmedRendererSession("task-unconfirmed")).resolves.toBe("materialized");

    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]).toMatchObject({
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionPath: created.path
      },
      sessionId: created.id,
      sessionPath: created.path,
      lifecycle: "stopped",
      runtime: { phase: "stopped" },
      creationId: undefined,
      creationStatus: undefined
    });
    expect(useAppStore.getState().runtime).toMatchObject({ phase: "stopped" });
    expect(request).toHaveBeenNthCalledWith(1, "session.creation.resolve", {
      creationId: "session-creation-unconfirmed"
    }, [], { context: { scope: "workspace", workspaceId: "workspace-a" } });
    expect(request).toHaveBeenNthCalledWith(2, "session.catalog.query", expect.objectContaining({
      scope: "workspace",
      refresh: true
    }), [], { context: { scope: "workspace", workspaceId: "workspace-a" } });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "success",
      title: "已找到新建的对话"
    });
  });

  it("reports an unavailable resolver without discarding the unconfirmed Task", async () => {
    openUnconfirmedTask();
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("catalog unavailable"));

    await expect(recheckUnconfirmedRendererSession("task-unconfirmed")).resolves.toBe("unavailable");

    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]?.creationStatus).toBe("unconfirmed");
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "暂时无法检查创建结果"
    });
  });

  it.each(["missing", "ambiguous"] as const)(
    "keeps an unconfirmed Task when the resolver reports %s",
    async (status) => {
      openUnconfirmedTask();
      const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
        status,
        creationId: "session-creation-unconfirmed"
      } as never);

      await expect(recheckUnconfirmedRendererSession("task-unconfirmed")).resolves.toBe("still-unconfirmed");

      expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]?.conversation.kind).toBe("provisional");
      expect(request).toHaveBeenCalledOnce();
      expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
        level: "warning",
        title: "仍无法确认创建结果"
      });
    }
  );

  it.each([
    {
      name: "the exact Session is missing",
      page: catalogPage([]),
      expected: "still-unconfirmed"
    },
    {
      name: "the Catalog is still rebuilding",
      page: catalogPage([], {
        source: "sdk-fallback",
        state: "fallback",
        rebuilding: true,
        incomplete: true
      }),
      expected: "unavailable"
    },
    {
      name: "the Session id matches but the path differs",
      page: catalogPage([catalogSession("session-created", 10_100, {
        path: "/sessions/different-path.jsonl"
      })]),
      expected: "still-unconfirmed"
    },
    {
      name: "the Session path matches but the id differs",
      page: catalogPage([catalogSession("different-id", 10_100, {
        path: "/sessions/session-created.jsonl"
      })]),
      expected: "still-unconfirmed"
    }
  ] as const)("fails closed when $name", async ({ page, expected }) => {
    openUnconfirmedTask();
    mockMaterializedResolution(page);

    await expect(recheckUnconfirmedRendererSession("task-unconfirmed", { notify: false }))
      .resolves.toBe(expected);

    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]).toMatchObject({
      conversation: { kind: "provisional" },
      creationId: "session-creation-unconfirmed",
      creationStatus: "unconfirmed"
    });
  });

  it("keeps the placeholder when another Workbench Task already owns the exact Session", async () => {
    openUnconfirmedTask();
    const created = catalogSession("session-created", 10_100);
    rendererWorkbenchStore.getState().openTask({
      ...unconfirmedTask(),
      id: "task-existing-owner",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionPath: created.path
      },
      sessionId: created.id,
      sessionPath: created.path,
      lifecycle: "stopped",
      runtime: { phase: "stopped", detail: "stopped", recoverable: true },
      creationId: undefined,
      creationStatus: undefined
    });
    mockMaterializedResolution(catalogPage([created]));

    await expect(recheckUnconfirmedRendererSession("task-unconfirmed", { notify: false }))
      .resolves.toBe("still-unconfirmed");

    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]?.creationStatus)
      .toBe("unconfirmed");
  });

  it.each(["generation", "creation-id"] as const)(
    "rejects a materialized result when the Task %s changes during Catalog confirmation",
    async (change) => {
      openUnconfirmedTask();
      const created = catalogSession("session-created", 10_100);
      vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
        if (type === "session.creation.resolve") {
          return {
            status: "materialized",
            creationId: "session-creation-unconfirmed",
            sessionId: created.id,
            sessionPath: created.path
          } as never;
        }
        if (type === "session.catalog.query") {
          rendererWorkbenchStore.getState().updateTask("task-unconfirmed", change === "generation"
            ? { taskGeneration: 2 }
            : { creationId: "session-creation-replaced" });
          return catalogPage([created]) as never;
        }
        throw new Error(`Unexpected request: ${type}`);
      });

      await expect(recheckUnconfirmedRendererSession("task-unconfirmed", { notify: false }))
        .resolves.toBe("still-unconfirmed");

      expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]?.conversation.kind)
        .toBe("provisional");
    }
  );

  it("dismisses only the empty Renderer provisional without sending an Agent request", () => {
    openUnconfirmedTask();
    const request = vi.spyOn(agentConnectionController, "request");

    expect(dismissUnconfirmedRendererSession("task-unconfirmed")).toBe(true);

    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]).toBeUndefined();
    expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({
      kind: "workspace",
      workspaceId: "workspace-a"
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["draft", "attachment"] as const)(
    "refuses to dismiss an unconfirmed placeholder that still has a %s",
    (content) => {
      openUnconfirmedTask(content === "attachment" ? { attachmentCount: 1 } : {});
      if (content === "draft") {
        useTaskDraftStore.getState().setText("task-unconfirmed", "保留这个草稿");
      }

      expect(dismissUnconfirmedRendererSession("task-unconfirmed")).toBe(false);

      expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]?.creationStatus).toBe("unconfirmed");
      expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
        level: "warning",
        title: "无法放弃此占位"
      });
    }
  );
});

function openUnconfirmedTask(overrides: Partial<RendererWorkbenchTask> = {}): void {
  rendererWorkbenchStore.getState().openTask(unconfirmedTask(overrides));
}

function unconfirmedTask(overrides: Partial<RendererWorkbenchTask> = {}): RendererWorkbenchTask {
  return {
    id: "task-unconfirmed",
    conversation: {
      kind: "provisional",
      workspaceId: "workspace-a",
      draftId: "task-unconfirmed"
    },
    workspaceId: "workspace-a",
    sessionId: "pending:task-unconfirmed",
    taskGeneration: 1,
    lifecycle: "draft",
    runtime: { phase: "failed", detail: "unknown", recoverable: true },
    title: "未命名对话",
    hasDraft: false,
    toolMode: "auto",
    attachmentCount: 0,
    creationId: "session-creation-unconfirmed",
    creationStatus: "unconfirmed",
    ...overrides
  };
}

function catalogPage(
  items: SessionSummary[],
  overrides: Partial<SessionCatalogPage> = {}
): SessionCatalogPage {
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

function catalogSession(
  id: string,
  modifiedAt: number,
  overrides: Partial<SessionSummary> = {}
): SessionSummary {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/work/a",
    name: "未命名对话",
    nameSource: "fallback",
    modifiedAt,
    messageCount: 0,
    ...overrides
  };
}

function mockMaterializedResolution(page: SessionCatalogPage): void {
  const created = catalogSession("session-created", 10_100);
  vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
    if (type === "session.creation.resolve") {
      return {
        status: "materialized",
        creationId: "session-creation-unconfirmed",
        sessionId: created.id,
        sessionPath: created.path
      } as never;
    }
    if (type === "session.catalog.query") return page as never;
    throw new Error(`Unexpected request: ${type}`);
  });
}

function workspace() {
  return {
    id: "workspace-a",
    displayName: "A",
    identity: { canonicalPath: "/work/a", assurance: "filesystem" as const },
    trust: "trusted" as const,
    trustProvenance: "native-picker" as const,
    availability: "available" as const
  };
}
