import { describe, expect, it } from "vitest";
import {
  shouldProjectSession,
  workbenchTaskFromProjection
} from "./WorkbenchProjectionBridge.js";
import type { RendererWorkbenchTask } from "./workbench-store.js";

describe("WorkbenchProjectionBridge", () => {
  it("atomically replaces a stale Task lifecycle and runtime from the active projection", () => {
    const existing: RendererWorkbenchTask = {
      id: "task-a",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-a",
        sessionPath: "/work/a/session-a.jsonl"
      },
      workspaceId: "workspace-a",
      sessionId: "session-a",
      sessionFileIdentity: "session-file-a",
      sessionGeneration: 2,
      taskGeneration: 3,
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "ready", recoverable: true },
      title: "Task A",
      recentUserMessagePreview: "最后一次用户消息",
      sessionPath: "/work/a/session-a.jsonl",
      hasDraft: true,
      toolMode: "auto",
      attachmentCount: 2
    };

    expect(workbenchTaskFromProjection({
      existing,
      workspaceId: "workspace-a",
      sessionId: "session-a",
      sessionFileIdentity: "session-file-a",
      sessionGeneration: 2,
      operation: {
        operationId: "operation-a",
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-a",
        sessionFileIdentity: "session-file-a",
        sessionGeneration: 2,
        startedAt: 1
      },
      runtime: { phase: "busy", detail: "running", recoverable: true },
      sessionName: "Task A",
      sessionPath: "/work/a/session-a.jsonl"
    })).toMatchObject({
      id: "task-a",
      taskGeneration: 3,
      hasDraft: true,
      attachmentCount: 2,
      recentUserMessagePreview: "最后一次用户消息",
      lifecycle: "running",
      runtime: { phase: "busy", detail: "running" },
      operationId: "operation-a"
    });
  });

  it("materializes a new Task from an authoritative Session projection", () => {
    const projected = workbenchTaskFromProjection({
      workspaceId: "workspace-a",
      sessionId: "session-a",
      sessionFileIdentity: "session-file-a",
      sessionGeneration: 2,
      operation: {
        operationId: "operation-a",
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-a",
        sessionFileIdentity: "session-file-a",
        sessionGeneration: 2,
        startedAt: 1
      },
      runtime: { phase: "busy", detail: "running", recoverable: true },
      sessionName: "Task A",
      sessionPath: "/work/a/session-a.jsonl"
    });
    expect(projected).toMatchObject({
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-a",
        sessionPath: "/work/a/session-a.jsonl"
      },
      sessionFileIdentity: "session-file-a",
      sessionPath: "/work/a/session-a.jsonl",
      lifecycle: "running",
      runtime: { phase: "busy", detail: "running" },
      toolMode: "auto"
    });
  });

  it("replaces a provisional conversation after Session creation is materialized", () => {
    const existing: RendererWorkbenchTask = {
      id: "task-pending",
      conversation: {
        kind: "provisional",
        workspaceId: "workspace-a",
        draftId: "task-pending"
      },
      workspaceId: "workspace-a",
      sessionId: "pending:task-pending",
      taskGeneration: 1,
      lifecycle: "initializing",
      runtime: { phase: "starting", detail: "creating", recoverable: true },
      title: "未命名任务",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0,
      creationStatus: "pending"
    };

    expect(workbenchTaskFromProjection({
      existing,
      workspaceId: "workspace-a",
      sessionId: "session-created",
      sessionFileIdentity: "session-file-created",
      sessionGeneration: 1,
      runtime: { phase: "ready", detail: "ready", recoverable: true },
      sessionPath: "/work/a/session-created.jsonl"
    })).toMatchObject({
      id: "task-pending",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-created",
        sessionPath: "/work/a/session-created.jsonl"
      },
      sessionId: "session-created",
      sessionFileIdentity: "session-file-created",
      sessionPath: "/work/a/session-created.jsonl",
      lifecycle: "idle",
      creationStatus: undefined
    });
  });

  it("projects an idle ready Task when no operation matches the Session authority", () => {
    const existing: RendererWorkbenchTask = {
      id: "task-a",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-a",
        sessionPath: "/work/a/session-a.jsonl"
      },
      workspaceId: "workspace-a",
      sessionId: "session-a",
      sessionFileIdentity: "session-file-a",
      sessionGeneration: 2,
      taskGeneration: 3,
      lifecycle: "running",
      runtime: { phase: "busy", detail: "stale operation", recoverable: true },
      title: "Task A",
      sessionPath: "/work/a/session-a.jsonl",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0,
      operationId: "old-operation"
    };

    expect(workbenchTaskFromProjection({
      existing,
      workspaceId: "workspace-a",
      sessionId: "session-a",
      sessionFileIdentity: "session-file-a",
      sessionGeneration: 2,
      operation: {
        operationId: "other-session-operation",
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-b",
        sessionFileIdentity: "session-file-b",
        sessionGeneration: 1,
        startedAt: 1
      },
      runtime: { phase: "busy", detail: "other Session", recoverable: true },
      sessionPath: "/work/a/session-a.jsonl"
    })).toMatchObject({
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "Pi SDK 已就绪" }
    });
  });

  it("keeps an accepted prompt ahead of a stale conversation page until Session authority changes", () => {
    const existing: RendererWorkbenchTask = {
      id: "task-a",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-a",
        sessionPath: "/work/a/session-a.jsonl"
      },
      workspaceId: "workspace-a",
      sessionId: "session-a",
      sessionFileIdentity: "session-file-a",
      sessionGeneration: 2,
      taskGeneration: 3,
      lifecycle: "accepted",
      runtime: { phase: "busy", detail: "running", recoverable: true },
      title: "Task A",
      recentUserMessagePreview: "刚刚接受的用户消息",
      sessionPath: "/work/a/session-a.jsonl",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0
    };

    expect(workbenchTaskFromProjection({
      existing,
      workspaceId: "workspace-a",
      sessionId: "session-a",
      sessionFileIdentity: "session-file-a",
      sessionGeneration: 2,
      runtime: { phase: "busy", detail: "running", recoverable: true },
      recentUserMessagePreview: "尚未刷新的旧消息",
      sessionName: "Task A",
      sessionPath: "/work/a/session-a.jsonl"
    }).recentUserMessagePreview).toBe("刚刚接受的用户消息");

    expect(workbenchTaskFromProjection({
      existing,
      workspaceId: "workspace-a",
      sessionId: "session-a",
      sessionFileIdentity: "session-file-a",
      sessionGeneration: 3,
      runtime: { phase: "ready", detail: "ready", recoverable: true },
      recentUserMessagePreview: "新分支中的最新消息",
      sessionName: "Task A",
      sessionPath: "/work/a/session-a.jsonl"
    }).recentUserMessagePreview).toBe("新分支中的最新消息");
  });

  it("does not attach a known Session projection to a different Workspace during Task switching", () => {
    const task: RendererWorkbenchTask = {
      id: "task-b",
      conversation: {
        kind: "session",
        workspaceId: "workspace-b",
        sessionFileIdentity: "session-file-b",
        sessionPath: "/work/b/session-b.jsonl"
      },
      workspaceId: "workspace-b",
      sessionId: "session-b",
      sessionFileIdentity: "session-file-b",
      sessionGeneration: 2,
      taskGeneration: 1,
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "ready", recoverable: true },
      title: "Task B",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0
    };

    expect(shouldProjectSession(
      { [task.id]: task },
      "workspace-a",
      "session-b",
      "session-file-b"
    )).toBe(false);
    expect(shouldProjectSession(
      { [task.id]: task },
      "workspace-b",
      "session-b",
      "session-file-b"
    )).toBe(true);
    expect(shouldProjectSession(
      { [task.id]: task },
      "workspace-a",
      "session-b",
      "session-file-other"
    )).toBe(true);
  });

  it("keeps one Task when the same physical Session is projected through a path alias", () => {
    const existing: RendererWorkbenchTask = {
      id: "task-a",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-a",
        sessionPath: "/sessions/original.jsonl"
      },
      workspaceId: "workspace-a",
      sessionId: "session-a",
      sessionFileIdentity: "session-file-a",
      sessionGeneration: 2,
      taskGeneration: 3,
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "ready", recoverable: true },
      title: "Task A",
      sessionPath: "/sessions/original.jsonl",
      hasDraft: true,
      toolMode: "auto",
      attachmentCount: 1
    };

    expect(workbenchTaskFromProjection({
      existing,
      workspaceId: "workspace-a",
      sessionId: "session-a",
      sessionFileIdentity: "session-file-a",
      sessionGeneration: 2,
      runtime: { phase: "ready", detail: "ready", recoverable: true },
      sessionPath: "/junction/sessions/alias.jsonl"
    })).toMatchObject({
      id: "task-a",
      conversation: {
        kind: "session",
        sessionFileIdentity: "session-file-a",
        sessionPath: "/junction/sessions/alias.jsonl"
      },
      sessionPath: "/junction/sessions/alias.jsonl",
      hasDraft: true,
      attachmentCount: 1
    });
  });

  it("keeps equal Session ids on distinct physical files independent", () => {
    const task = physicalTask("task-a", "session-file-a", "/sessions/a.jsonl");

    expect(shouldProjectSession(
      { [task.id]: task },
      "workspace-a",
      "shared-session-id",
      "session-file-b",
      "/sessions/b.jsonl"
    )).toBe(true);
  });

  it("fails closed on physical identity or locator contradictions", () => {
    const task = physicalTask("task-a", "session-file-a", "/sessions/a.jsonl");

    expect(shouldProjectSession(
      { [task.id]: task },
      "workspace-a",
      "different-session-id",
      "session-file-a",
      "/junction/sessions/a.jsonl"
    )).toBe(false);
    expect(shouldProjectSession(
      { [task.id]: task },
      "workspace-a",
      "shared-session-id",
      "session-file-b",
      "/sessions/a.jsonl"
    )).toBe(false);
  });
});

function physicalTask(
  id: string,
  sessionFileIdentity: string,
  sessionPath: string
): RendererWorkbenchTask {
  return {
    id,
    conversation: {
      kind: "session",
      workspaceId: "workspace-a",
      sessionFileIdentity,
      sessionPath
    },
    workspaceId: "workspace-a",
    sessionId: "shared-session-id",
    sessionFileIdentity,
    sessionGeneration: 2,
    taskGeneration: 1,
    lifecycle: "idle",
    runtime: { phase: "ready", detail: "ready", recoverable: true },
    title: id,
    sessionPath,
    hasDraft: false,
    toolMode: "auto",
    attachmentCount: 0
  };
}
