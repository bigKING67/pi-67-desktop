import { describe, expect, it } from "vitest";
import type { RendererWorkbenchTask } from "./workbench-store.js";
import {
  canRenderLiveTask,
  taskMatchesLiveSessionAuthority
} from "./live-task-authority.js";

describe("live Task authority", () => {
  it("requires the complete physical Session authority", () => {
    const current = task();

    expect(taskMatchesLiveSessionAuthority(current, "session-a", "session-file-a", 2)).toBe(true);
    expect(taskMatchesLiveSessionAuthority(current, "session-b", "session-file-a", 2)).toBe(false);
    expect(taskMatchesLiveSessionAuthority(current, "session-a", "session-file-b", 2)).toBe(false);
    expect(taskMatchesLiveSessionAuthority(current, "session-a", "session-file-a", 3)).toBe(false);
    const { sessionGeneration: _sessionGeneration, ...withoutGeneration } = current;
    expect(taskMatchesLiveSessionAuthority(withoutGeneration, "session-a", "session-file-a", 2))
      .toBe(false);
  });

  it("keeps stopped and lost Tasks out of the live conversation surface", () => {
    expect(canRenderLiveTask(task({ runtime: { phase: "stopped", detail: "stopped", recoverable: true } }),
      "session-a", "session-file-a", 2)).toBe(false);
    expect(canRenderLiveTask(task({ lifecycle: "lost" }), "session-a", "session-file-a", 2)).toBe(false);
  });
});

function task(overrides: Partial<RendererWorkbenchTask> = {}): RendererWorkbenchTask {
  return {
    id: "task-a",
    conversation: {
      kind: "session",
      workspaceId: "workspace-a",
      sessionFileIdentity: "session-file-a",
      sessionPath: "/sessions/a.jsonl"
    },
    workspaceId: "workspace-a",
    sessionId: "session-a",
    sessionFileIdentity: "session-file-a",
    sessionPath: "/sessions/a.jsonl",
    taskGeneration: 1,
    sessionGeneration: 2,
    lifecycle: "idle",
    runtime: { phase: "ready", detail: "ready", recoverable: true },
    title: "A",
    hasDraft: false,
    toolMode: "auto",
    attachmentCount: 0,
    ...overrides
  };
}
