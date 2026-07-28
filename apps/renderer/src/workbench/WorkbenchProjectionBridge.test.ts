import { describe, expect, it } from "vitest";
import {
  shouldProjectSession,
  workbenchTaskFromProjection
} from "./WorkbenchProjectionBridge.js";
import type { RendererWorkbenchTask } from "./workbench-store.js";

describe("WorkbenchProjectionBridge", () => {
  it("preserves task-local draft metadata while runtime projections update", () => {
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
      attachmentCount: 2
    };

    expect(workbenchTaskFromProjection({
      existing,
      workspaceId: "workspace-a",
      sessionId: "session-a",
      sessionGeneration: 2,
      runtime: { phase: "busy", detail: "running", recoverable: true },
      sessionName: "Task A",
      sessionPath: "/work/a/session-a.jsonl"
    })).toMatchObject({
      id: "task-a",
      taskGeneration: 3,
      hasDraft: true,
      attachmentCount: 2,
      recentUserMessagePreview: "最后一次用户消息",
      runtime: { phase: "busy" }
    });
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
      attachmentCount: 0
    };

    expect(shouldProjectSession({ [task.id]: task }, "workspace-a", "session-b")).toBe(false);
    expect(shouldProjectSession({ [task.id]: task }, "workspace-b", "session-b")).toBe(true);
    expect(shouldProjectSession({ [task.id]: task }, "workspace-a", "session-new")).toBe(true);
  });
});
