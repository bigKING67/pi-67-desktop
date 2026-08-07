import type { TaskLifecycle } from "@pi67/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import {
  rendererWorkbenchStore,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { queryFirstSessionCatalog } from "./session-catalog-controller.js";
import {
  archiveRendererConversation,
  renameRendererConversation,
  setRendererConversationPinned
} from "./conversation-organization-controller.js";

vi.mock("./session-catalog-controller.js", () => ({
  queryFirstSessionCatalog: vi.fn().mockResolvedValue(true)
}));

const refreshCatalog = vi.mocked(queryFirstSessionCatalog);

describe("conversation organization controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshCatalog.mockReset().mockResolvedValue(true);
    rendererWorkbenchStore.getState().reset();
    useTaskDraftStore.getState().dispose();
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-a",
      displayName: "Workspace A",
      identity: { canonicalPath: "/work/a", assurance: "path-only" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
  });

  it("blocks active tasks and unsent drafts before issuing an archive mutation", async () => {
    installTask("running", { phase: "busy", detail: "running", recoverable: true });
    const request = vi.spyOn(agentConnectionController, "request");

    await expect(archiveRendererConversation("workspace-a", session("a"))).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "暂时无法归档对话"
    });

    rendererWorkbenchStore.getState().updateTask("task-a", {
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "ready", recoverable: true }
    });
    useTaskDraftStore.getState().setText("task-a", "尚未发送");
    await expect(archiveRendererConversation("workspace-a", session("a"))).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      message: "输入框中仍有未发送内容，请发送或清空草稿。"
    });
  });

  it("disposes an idle Runtime, archives the conversation, and exposes a working undo action", async () => {
    installTask("completed", { phase: "ready", detail: "ready", recoverable: true });
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => (
      type === "task.close"
        ? { closed: true, stopped: false }
        : { revision: type === "conversation.archive" ? 7 : 0 }
    ) as never);

    await expect(archiveRendererConversation("workspace-a", session("a"))).resolves.toBe(true);
    expect(request.mock.calls.map(([type]) => type)).toEqual(["task.close", "conversation.archive"]);
    expect(request.mock.calls[1]).toEqual([
      "conversation.archive",
      { path: "/sessions/a.jsonl", archived: true },
      [],
      { context: { scope: "workspace", workspaceId: "workspace-a" } }
    ]);
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toBeUndefined();
    expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({
      kind: "workspace",
      workspaceId: "workspace-a"
    });
    expect(refreshCatalog).toHaveBeenCalledWith("workspace-a");

    const archived = useNotificationStore.getState().items.at(-1);
    expect(archived).toMatchObject({
      level: "success",
      title: "对话已归档",
      action: { label: "撤销" }
    });
    await archived?.action?.run();
    expect(request.mock.calls.at(-1)).toEqual([
      "conversation.archive",
      { path: "/sessions/a.jsonl", archived: false },
      [],
      { context: { scope: "workspace", workspaceId: "workspace-a" } }
    ]);
  });

  it("keeps the conversation intact when Runtime disposal fails", async () => {
    installTask("completed", { phase: "ready", detail: "ready", recoverable: true });
    const request = vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("busy"));

    await expect(archiveRendererConversation("workspace-a", session("a"))).resolves.toBe(false);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe("task.close");
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toBeDefined();
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法释放对话运行资源",
      message: "busy"
    });
  });

  it("uses Task authority for live renames and restores the immediate automatic title", async () => {
    installTask("idle", { phase: "ready", detail: "ready", recoverable: true });
    rendererWorkbenchStore.getState().updateTask("task-a", {
      recentUserMessagePreview: "修复冷启动标题"
    });
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);

    await expect(renameRendererConversation("workspace-a", session("a"), "固定标题"))
      .resolves.toBe(true);
    expect(request.mock.calls[0]).toEqual([
      "session.name",
      { mutation: { action: "set", name: "固定标题" } },
      [],
      { context: taskContext() }
    ]);
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toMatchObject({
      title: "固定标题",
      titleSource: "explicit"
    });

    await expect(renameRendererConversation("workspace-a", session("a"), undefined))
      .resolves.toBe(true);
    expect(request.mock.calls[1]).toEqual([
      "session.name",
      { mutation: { action: "clear" } },
      [],
      { context: taskContext() }
    ]);
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toMatchObject({
      title: "修复冷启动标题",
      titleSource: "latest-user"
    });
  });

  it("uses Workspace authority for cold renames and pin mutations", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({ revision: 3 } as never);

    await expect(renameRendererConversation("workspace-a", session("cold"), "冷对话"))
      .resolves.toBe(true);
    await expect(setRendererConversationPinned("workspace-a", {
      fileIdentity: "session-file-cold",
      path: "/sessions/cold.jsonl"
    })).resolves.toBe(true);

    expect(request.mock.calls).toEqual([
      [
        "session.nameByPath",
        { path: "/sessions/cold.jsonl", mutation: { action: "set", name: "冷对话" } },
        [],
        { context: { scope: "workspace", workspaceId: "workspace-a" } }
      ],
      [
        "conversation.pin",
        { path: "/sessions/cold.jsonl", pinned: true },
        [],
        { context: { scope: "workspace", workspaceId: "workspace-a" } }
      ]
    ]);
  });

  it("does not attach a replacement physical file to a stale live Task at the same path", async () => {
    installTask("running", { phase: "busy", detail: "running", recoverable: true });
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({ revision: 3 } as never);

    await expect(archiveRendererConversation("workspace-a", {
      fileIdentity: "session-file-replacement",
      path: "/sessions/a.jsonl"
    })).resolves.toBe(true);

    expect(request.mock.calls.map(([type]) => type)).toEqual(["conversation.archive"]);
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toBeDefined();
  });
});

function session(name: string) {
  return {
    fileIdentity: `session-file-${name}`,
    path: `/sessions/${name}.jsonl`
  };
}

function installTask(lifecycle: TaskLifecycle, runtime: RendererWorkbenchTask["runtime"]): void {
  rendererWorkbenchStore.getState().openTask({
    id: "task-a",
    conversation: {
      kind: "session",
      workspaceId: "workspace-a",
      sessionFileIdentity: "session-file-a",
      sessionPath: "/sessions/a.jsonl"
    },
    workspaceId: "workspace-a",
    sessionId: "session-a",
    taskGeneration: 2,
    sessionGeneration: 3,
    lifecycle,
    runtime,
    title: "原始标题",
    titleSource: "fallback",
    sessionPath: "/sessions/a.jsonl",
    hasDraft: false,
    attachmentCount: 0,
    toolMode: "auto"
  });
}

function taskContext() {
  return {
    scope: "task" as const,
    workspaceId: "workspace-a",
    taskId: "task-a",
    taskGeneration: 2,
    sessionId: "session-a",
    sessionFileIdentity: "session-file-a",
    sessionGeneration: 3
  };
}
