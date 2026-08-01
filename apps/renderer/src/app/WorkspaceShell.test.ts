import type { RendererWorkbenchTask } from "../workbench/workbench-store.js";
import { describe, expect, it } from "vitest";
import { canRenderLiveTask } from "./WorkspaceShell.js";

describe("WorkspaceShell live task selection", () => {
  it("does not render a stopped task as a live conversation when a stale projection still matches", () => {
    expect(canRenderLiveTask(task({
      lifecycle: "completed",
      runtime: { phase: "stopped", detail: "会话待打开", recoverable: true }
    }), "session-a")).toBe(false);
  });

  it("does not render a lost task as a live conversation", () => {
    expect(canRenderLiveTask(task({
      lifecycle: "lost",
      runtime: { phase: "failed", detail: "上次运行已中断", recoverable: true }
    }), "session-a")).toBe(false);
  });

  it("renders the selected task only when its live projection is current", () => {
    const ready = task({
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "Pi SDK 已就绪", recoverable: true }
    });

    expect(canRenderLiveTask(ready, "session-a")).toBe(true);
    expect(canRenderLiveTask(ready, "session-b")).toBe(false);
    expect(canRenderLiveTask(undefined, "session-a")).toBe(false);
  });
});

function task(overrides: Pick<RendererWorkbenchTask, "lifecycle" | "runtime">): RendererWorkbenchTask {
  return {
    id: "task-a",
    conversation: {
      kind: "session",
      workspaceId: "workspace-a",
      sessionPath: "/sessions/a.jsonl"
    },
    workspaceId: "workspace-a",
    sessionId: "session-a",
    sessionPath: "/sessions/a.jsonl",
    taskGeneration: 1,
    title: "A",
    hasDraft: false,
    toolMode: "auto",
    attachmentCount: 0,
    ...overrides
  };
}
