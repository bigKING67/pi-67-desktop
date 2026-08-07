import type { SessionSummary } from "@pi67/domain";
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

  it("materializes the exact resolver identity without waiting for Catalog metadata", async () => {
    openUnconfirmedTask();
    const created = catalogSession("session-created", 10_100);
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "session.creation.resolve") {
        return {
          status: "materialized",
          creationId: "session-creation-unconfirmed",
          sessionId: created.id,
          sessionFileIdentity: created.fileIdentity,
          sessionPath: created.path
        } as never;
      }
      throw new Error(`Unexpected request: ${type}`);
    });

    await expect(recheckUnconfirmedRendererSession("task-unconfirmed")).resolves.toBe("materialized");

    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]).toMatchObject({
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: created.fileIdentity,
        sessionPath: created.path
      },
      sessionId: created.id,
      sessionFileIdentity: created.fileIdentity,
      sessionPath: created.path,
      lifecycle: "stopped",
      runtime: { phase: "stopped" },
      creationId: undefined,
      creationStatus: undefined,
      sessionMetadataStatus: "indexing"
    });
    expect(useAppStore.getState().runtime).toMatchObject({ phase: "stopped" });
    expect(request).toHaveBeenCalledWith("session.creation.resolve", {
      creationId: "session-creation-unconfirmed"
    }, [], { context: { scope: "workspace", workspaceId: "workspace-a" } });
    expect(request).toHaveBeenCalledOnce();
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

  it("does not query an unavailable or rebuilding Catalog after exact marker resolution", async () => {
    openUnconfirmedTask();
    mockMaterializedResolution();

    await expect(recheckUnconfirmedRendererSession("task-unconfirmed", { notify: false }))
      .resolves.toBe("materialized");

    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]).toMatchObject({
      conversation: { kind: "session" },
      creationId: undefined,
      creationStatus: undefined,
      sessionMetadataStatus: "indexing"
    });
  });

  it("merges an empty placeholder when another Workbench Task already owns the exact Session", async () => {
    openUnconfirmedTask();
    const created = catalogSession("session-created", 10_100);
    openExistingOwner(created);
    mockMaterializedResolution();

    await expect(recheckUnconfirmedRendererSession("task-unconfirmed", { notify: false }))
      .resolves.toBe("materialized");

    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]).toBeUndefined();
    expect(rendererWorkbenchStore.getState().tasks["task-existing-owner"]?.sessionPath).toBe(created.path);
  });

  it("merges an exact physical owner even when its current locator is an alias", async () => {
    openUnconfirmedTask();
    const created = catalogSession("session-created", 10_100);
    openExistingOwner(created, {
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: created.fileIdentity,
        sessionPath: "/junction/sessions/session-created.jsonl"
      },
      sessionPath: "/junction/sessions/session-created.jsonl"
    });
    mockMaterializedResolution();

    await expect(recheckUnconfirmedRendererSession("task-unconfirmed", { notify: false }))
      .resolves.toBe("materialized");

    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]).toBeUndefined();
    expect(rendererWorkbenchStore.getState().tasks["task-existing-owner"]?.sessionFileIdentity)
      .toBe(created.fileIdentity);
  });

  it("moves a provisional draft into an empty exact Session owner", async () => {
    openUnconfirmedTask({ hasDraft: true });
    useTaskDraftStore.getState().setText("task-unconfirmed", "保留这个草稿");
    const created = catalogSession("session-created", 10_100);
    openExistingOwner(created);
    mockMaterializedResolution();

    await expect(recheckUnconfirmedRendererSession("task-unconfirmed", { notify: false }))
      .resolves.toBe("materialized");

    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]).toBeUndefined();
    expect(rendererWorkbenchStore.getState().tasks["task-existing-owner"]).toMatchObject({
      hasDraft: true,
      attachmentCount: 0
    });
    expect(useTaskDraftStore.getState().drafts["task-unconfirmed"]).toBeUndefined();
    expect(useTaskDraftStore.getState().drafts["task-existing-owner"]?.text).toBe("保留这个草稿");
  });

  it("keeps both Tasks and drafts when exact-owner merge has conflicting content", async () => {
    openUnconfirmedTask({ hasDraft: true });
    useTaskDraftStore.getState().setText("task-unconfirmed", "占位草稿");
    const created = catalogSession("session-created", 10_100);
    openExistingOwner(created, { hasDraft: true });
    useTaskDraftStore.getState().setText("task-existing-owner", "目标草稿");
    mockMaterializedResolution();

    await expect(recheckUnconfirmedRendererSession("task-unconfirmed"))
      .resolves.toBe("still-unconfirmed");

    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]?.creationStatus)
      .toBe("unconfirmed");
    expect(rendererWorkbenchStore.getState().tasks["task-existing-owner"]).toBeDefined();
    expect(useTaskDraftStore.getState().drafts["task-unconfirmed"]?.text).toBe("占位草稿");
    expect(useTaskDraftStore.getState().drafts["task-existing-owner"]?.text).toBe("目标草稿");
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      message: expect.stringContaining("草稿")
    });
  });

  it("keeps duplicate Session ids on distinct paths independent", async () => {
    openUnconfirmedTask();
    rendererWorkbenchStore.getState().openTask({
      ...unconfirmedTask(),
      id: "task-same-id-other-path",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-other-copy",
        sessionPath: "/sessions/other-copy.jsonl"
      },
      sessionId: "session-created",
      sessionPath: "/sessions/other-copy.jsonl",
      lifecycle: "stopped",
      runtime: { phase: "stopped", detail: "stopped", recoverable: true },
      creationId: undefined,
      creationStatus: undefined
    });
    mockMaterializedResolution();

    await expect(recheckUnconfirmedRendererSession("task-unconfirmed", { notify: false }))
      .resolves.toBe("materialized");

    expect(Object.values(rendererWorkbenchStore.getState().tasks).filter((task) => (
      task.sessionId === "session-created"
    ))).toHaveLength(2);
  });

  it("fails closed when an existing Task binds the resolved path to another Session id", async () => {
    openUnconfirmedTask();
    const created = catalogSession("session-created", 10_100);
    rendererWorkbenchStore.getState().openTask({
      ...unconfirmedTask(),
      id: "task-path-conflict",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-replacement",
        sessionPath: created.path
      },
      sessionId: "different-id",
      sessionPath: created.path,
      lifecycle: "stopped",
      runtime: { phase: "stopped", detail: "stopped", recoverable: true },
      creationId: undefined,
      creationStatus: undefined
    });
    mockMaterializedResolution();

    await expect(recheckUnconfirmedRendererSession("task-unconfirmed", { notify: false }))
      .resolves.toBe("still-unconfirmed");

    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]?.creationStatus)
      .toBe("unconfirmed");
  });

  it("fails closed when one physical identity is already bound to another Session id", async () => {
    openUnconfirmedTask();
    const created = catalogSession("session-created", 10_100);
    openExistingOwner(created, { sessionId: "contradictory-session-id" });
    mockMaterializedResolution();

    await expect(recheckUnconfirmedRendererSession("task-unconfirmed", { notify: false }))
      .resolves.toBe("still-unconfirmed");

    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]?.creationStatus)
      .toBe("unconfirmed");
  });

  it.each(["generation", "creation-id"] as const)(
    "rejects a materialized result when the Task %s changes during exact resolution",
    async (change) => {
      openUnconfirmedTask();
      const created = catalogSession("session-created", 10_100);
      vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
        if (type === "session.creation.resolve") {
          rendererWorkbenchStore.getState().updateTask("task-unconfirmed", change === "generation"
            ? { taskGeneration: 2 }
            : { creationId: "session-creation-replaced" });
          return {
            status: "materialized",
            creationId: "session-creation-unconfirmed",
            sessionId: created.id,
            sessionFileIdentity: created.fileIdentity,
            sessionPath: created.path
          } as never;
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

function catalogSession(
  id: string,
  modifiedAt: number,
  overrides: Partial<SessionSummary> = {}
): SessionSummary {
  return {
    fileIdentity: `session-file-fixture-${id}`,
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

function mockMaterializedResolution(): void {
  const created = catalogSession("session-created", 10_100);
  vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
    if (type === "session.creation.resolve") {
      return {
        status: "materialized",
        creationId: "session-creation-unconfirmed",
        sessionId: created.id,
        sessionFileIdentity: created.fileIdentity,
        sessionPath: created.path
      } as never;
    }
    throw new Error(`Unexpected request: ${type}`);
  });
}

function openExistingOwner(
  session: SessionSummary,
  overrides: Partial<RendererWorkbenchTask> = {}
): void {
  rendererWorkbenchStore.getState().openTask({
    ...unconfirmedTask(),
    id: "task-existing-owner",
    conversation: {
      kind: "session",
      workspaceId: "workspace-a",
      sessionFileIdentity: session.fileIdentity,
      sessionPath: session.path
    },
    sessionId: session.id,
    sessionFileIdentity: session.fileIdentity,
    sessionPath: session.path,
    lifecycle: "stopped",
    runtime: { phase: "stopped", detail: "stopped", recoverable: true },
    creationId: undefined,
    creationStatus: undefined,
    ...overrides
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
