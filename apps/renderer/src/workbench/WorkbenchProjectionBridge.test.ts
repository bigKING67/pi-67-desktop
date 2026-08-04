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
      conversation: { kind: "session", workspaceId: "workspace-a", sessionPath: "/work/a/session-a.jsonl" },
      workspaceId: "workspace-a",
      sessionId: "session-a",
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
      sessionGeneration: 2,
      operation: {
        operationId: "operation-a",
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-a",
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
      sessionGeneration: 2,
      operation: {
        operationId: "operation-a",
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-a",
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
        sessionPath: "/work/a/session-a.jsonl"
      },
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
      sessionGeneration: 1,
      runtime: { phase: "ready", detail: "ready", recoverable: true },
      sessionPath: "/work/a/session-created.jsonl"
    })).toMatchObject({
      id: "task-pending",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionPath: "/work/a/session-created.jsonl"
      },
      sessionId: "session-created",
      sessionPath: "/work/a/session-created.jsonl",
      lifecycle: "idle",
      creationStatus: undefined
    });
  });

  it("projects an idle ready Task when no operation matches the Session authority", () => {
    const existing: RendererWorkbenchTask = {
      id: "task-a",
      conversation: { kind: "session", workspaceId: "workspace-a", sessionPath: "/work/a/session-a.jsonl" },
      workspaceId: "workspace-a",
      sessionId: "session-a",
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
      sessionGeneration: 2,
      operation: {
        operationId: "other-session-operation",
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-b",
        sessionGeneration: 1,
        startedAt: 1
      },
      runtime: { phase: "busy", detail: "other Session", recoverable: true }
    })).toMatchObject({
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "Pi SDK 已就绪" }
    });
  });

  it("keeps an accepted prompt ahead of a stale conversation page until Session authority changes", () => {
    const existing: RendererWorkbenchTask = {
      id: "task-a",
      conversation: { kind: "session", workspaceId: "workspace-a", sessionPath: "/work/a/session-a.jsonl" },
      workspaceId: "workspace-a",
      sessionId: "session-a",
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
      conversation: { kind: "session", workspaceId: "workspace-b", sessionPath: "/work/b/session-b.jsonl" },
      workspaceId: "workspace-b",
      sessionId: "session-b",
      sessionGeneration: 2,
      taskGeneration: 1,
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "ready", recoverable: true },
      title: "Task B",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0
    };

    expect(shouldProjectSession({ [task.id]: task }, "workspace-a", "session-b")).toBe(false);
    expect(shouldProjectSession({ [task.id]: task }, "workspace-b", "session-b")).toBe(true);
    expect(shouldProjectSession({ [task.id]: task }, "workspace-a", "session-new")).toBe(true);
  });
});
