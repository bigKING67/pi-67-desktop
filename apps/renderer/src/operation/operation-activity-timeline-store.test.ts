import type { OperationView } from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createOperationActivityTimeline,
  createResynchronizedOperationActivityTimeline,
  finishOperationActivityTimeline,
  recordOperationTimelineActivity,
  recordOperationTimelineToolExecution,
  timelineMatchesOperation,
  updateOperationTimelineProgress,
  useOperationActivityTimelineStore
} from "./operation-activity-timeline-store.js";

describe("operation activity timeline", () => {
  beforeEach(() => useOperationActivityTimelineStore.getState().reset());

  it("records real activity transitions and settles the previous step", () => {
    let timeline = createOperationActivityTimeline(operation());
    timeline = recordOperationTimelineActivity(timeline, { kind: "thinking" }, 20);
    timeline = recordOperationTimelineActivity(timeline, {
      kind: "tool",
      toolCallId: "tool-1",
      toolName: "Bash",
      toolKind: "shell",
      status: "running",
      aliasTarget: "bash"
    }, 30);

    expect(timeline.steps).toMatchObject([
      { activity: undefined, status: "completed", settledAt: 20 },
      { activity: { kind: "thinking" }, status: "completed", settledAt: 30 },
      {
        activity: {
          kind: "tool",
          toolCallId: "tool-1",
          toolName: "Bash",
          toolKind: "shell",
          status: "running",
          aliasTarget: "bash"
        },
        status: "running",
        detail: "已兼容转发到 bash · 执行中"
      }
    ]);
  });

  it("deduplicates repeated activity while preserving progress", () => {
    let timeline = createOperationActivityTimeline(operation());
    timeline = recordOperationTimelineActivity(timeline, { kind: "responding" }, 20);
    const repeated = recordOperationTimelineActivity(timeline, { kind: "responding" }, 30);
    const progressed = updateOperationTimelineProgress(repeated, "正在生成 2/3");

    expect(repeated).toBe(timeline);
    expect(progressed.steps).toHaveLength(2);
    expect(progressed.steps.at(-1)?.detail).toBe("正在生成 2/3");
  });

  it("keeps an explicit processing step when Host clears a specific activity", () => {
    let timeline = createOperationActivityTimeline(operation());
    timeline = recordOperationTimelineActivity(timeline, { kind: "thinking" }, 20);
    timeline = recordOperationTimelineActivity(timeline, null, 30);

    expect(timeline.steps.at(-1)).toMatchObject({ activity: null, status: "running", startedAt: 30 });
  });

  it("restores only the current Host activity after projection resync", () => {
    const current = {
      ...operation(),
      activity: {
        kind: "tool",
        toolCallId: "tool-current",
        toolName: "edit",
        toolKind: "edit",
        status: "running"
      } as const
    };
    const timeline = createResynchronizedOperationActivityTimeline(current, 50);

    expect(timeline.startedAt).toBe(10);
    expect(timeline.steps).toEqual([{
      id: "operation-1:0",
      activity: current.activity,
      status: "running",
      startedAt: 50
    }]);
  });

  it("settles a failed timeline without claiming completion", () => {
    let timeline = createOperationActivityTimeline(operation());
    timeline = recordOperationTimelineActivity(timeline, { kind: "thinking" }, 20);
    timeline = finishOperationActivityTimeline(timeline, "failed", "测试失败", 40);

    expect(timeline).toMatchObject({ lifecycle: "failed", settledAt: 40 });
    expect(timeline.steps.at(-1)).toMatchObject({ status: "failed", detail: "测试失败", settledAt: 40 });
  });

  it("settles the matching tool step from the real tool outcome without adding a false success step", () => {
    let timeline = createOperationActivityTimeline(operation());
    timeline = recordOperationTimelineActivity(timeline, {
      kind: "tool",
      toolCallId: "tool-failed",
      toolName: "WebSearch",
      toolKind: "search",
      status: "running",
      aliasTarget: "web_search"
    }, 20);
    timeline = recordOperationTimelineActivity(timeline, {
      kind: "tool",
      toolCallId: "tool-failed",
      toolName: "WebSearch",
      toolKind: "search",
      status: "failed",
      aliasTarget: "web_search"
    }, 45);
    const afterClear = recordOperationTimelineActivity(timeline, null, 50);

    expect(timeline.steps).toHaveLength(2);
    expect(timeline.steps.at(-1)).toMatchObject({
      status: "failed",
      settledAt: 45,
      detail: "已兼容转发到 web_search · 执行失败",
      activity: { toolName: "WebSearch", status: "failed" }
    });
    expect(afterClear).toBe(timeline);
  });

  it("updates a delegated Tool in place without inventing child-agent fields", () => {
    let timeline = createOperationActivityTimeline(operation());
    timeline = recordOperationTimelineActivity(timeline, {
      kind: "tool",
      toolCallId: "delegated-1",
      toolName: "delegate_task",
      toolKind: "subagent",
      status: "running"
    }, 20);
    timeline = recordOperationTimelineActivity(timeline, {
      kind: "tool",
      toolCallId: "delegated-1",
      toolName: "delegate_task",
      toolKind: "subagent",
      status: "failed"
    }, 45);

    expect(timeline.steps).toHaveLength(2);
    expect(timeline.steps.at(-1)).toMatchObject({
      status: "failed",
      startedAt: 20,
      settledAt: 45,
      activity: {
        toolCallId: "delegated-1",
        toolKind: "subagent",
        status: "failed"
      }
    });
    expect(Object.keys(timeline.steps.at(-1)?.activity ?? {}).sort()).toEqual([
      "kind",
      "status",
      "toolCallId",
      "toolKind",
      "toolName"
    ]);
  });

  it("projects only the bounded Runtime-authored AUTO reason into Tool detail", () => {
    let timeline = createOperationActivityTimeline(operation());
    timeline = recordOperationTimelineActivity(timeline, {
      kind: "tool",
      toolCallId: "tool-auto",
      toolName: "read",
      toolKind: "read",
      status: "running",
      authorization: { mode: "auto", reason: "read-only" }
    }, 20);
    timeline = recordOperationTimelineActivity(timeline, {
      kind: "tool",
      toolCallId: "tool-auto",
      toolName: "read",
      toolKind: "read",
      status: "completed",
      authorization: { mode: "auto", reason: "read-only" }
    }, 30);

    expect(timeline.steps.at(-1)).toMatchObject({
      activity: {
        authorization: { mode: "auto", reason: "read-only" }
      },
      detail: "AUTO · 只读 · 执行成功",
      status: "completed"
    });
  });

  it("labels AUTO-authorized workspace commands distinctly from file writes", () => {
    let timeline = createOperationActivityTimeline(operation());
    timeline = recordOperationTimelineActivity(timeline, {
      kind: "tool",
      toolCallId: "tool-auto-command",
      toolName: "bash",
      toolKind: "shell",
      status: "completed",
      authorization: { mode: "auto", reason: "workspace-command" }
    }, 20);

    expect(timeline.steps.at(-1)).toMatchObject({
      detail: "AUTO · 工作区命令 · 执行成功",
      activity: { authorization: { mode: "auto", reason: "workspace-command" } }
    });
  });

  it("adds a late AUTO reason to the running Tool without creating a duplicate step", () => {
    let timeline = createOperationActivityTimeline(operation());
    timeline = recordOperationTimelineActivity(timeline, {
      kind: "tool",
      toolCallId: "tool-auto-late",
      toolName: "read",
      toolKind: "read",
      status: "running"
    }, 20);
    const beforeAuthorization = timeline;
    timeline = recordOperationTimelineActivity(timeline, {
      kind: "tool",
      toolCallId: "tool-auto-late",
      toolName: "read",
      toolKind: "read",
      status: "running",
      authorization: { mode: "auto", reason: "read-only" }
    }, 30);

    expect(timeline.steps).toHaveLength(beforeAuthorization.steps.length);
    expect(timeline.nextStepSequence).toBe(beforeAuthorization.nextStepSequence);
    expect(timeline.steps.at(-1)).toMatchObject({
      startedAt: 20,
      status: "running",
      detail: "AUTO · 只读 · 执行中",
      activity: { authorization: { mode: "auto", reason: "read-only" } }
    });
  });

  it("uses Runtime timing and progress for a Tool instead of renderer observation time", () => {
    let timeline = createOperationActivityTimeline(operation());
    timeline = recordOperationTimelineToolExecution(timeline, {
      toolCallId: "tool-timed",
      toolName: "bash",
      toolKind: "shell",
      status: "running",
      projectionSource: "live",
      resultState: "pending",
      startedAt: 1_000,
      command: { text: "pnpm test", truncated: false },
      progress: { text: "running", truncated: false }
    });
    timeline = recordOperationTimelineToolExecution(timeline, {
      toolCallId: "tool-timed",
      toolName: "bash",
      toolKind: "shell",
      status: "completed",
      projectionSource: "live",
      resultState: "present",
      startedAt: 1_000,
      completedAt: 1_250,
      durationMs: 250,
      command: { text: "pnpm test", truncated: false },
      progress: { text: "done", truncated: false }
    });

    expect(timeline.steps.at(-1)).toMatchObject({
      status: "completed",
      startedAt: 1_000,
      settledAt: 1_250,
      toolExecution: {
        toolCallId: "tool-timed",
        durationMs: 250,
        progress: { text: "done" }
      }
    });
  });

  it("updates any parallel Tool step by id without duplicating it", () => {
    let timeline = createOperationActivityTimeline(operation());
    for (const toolCallId of ["a", "b"]) {
      timeline = recordOperationTimelineToolExecution(timeline, {
        toolCallId,
        toolName: "read",
        toolKind: "read",
        status: "running",
        projectionSource: "live",
        resultState: "pending",
        startedAt: toolCallId === "a" ? 20 : 30
      });
    }
    timeline = recordOperationTimelineToolExecution(timeline, {
      toolCallId: "a",
      toolName: "read",
      toolKind: "read",
      status: "failed",
      projectionSource: "live",
      resultState: "present",
      startedAt: 20,
      completedAt: 40,
      failure: { detailState: "available", source: "runtime-event", message: { text: "missing", truncated: false } }
    });

    const toolSteps = timeline.steps.filter((step) => step.activity?.kind === "tool");
    expect(toolSteps).toHaveLength(2);
    expect(toolSteps.find((step) => step.activity?.kind === "tool" && step.activity.toolCallId === "a"))
      .toMatchObject({ status: "failed", settledAt: 40 });
    expect(toolSteps.find((step) => step.activity?.kind === "tool" && step.activity.toolCallId === "b"))
      .toMatchObject({ status: "running", settledAt: undefined });
  });

  it("matches only the current operation authority", () => {
    const current = operation();
    const timeline = createOperationActivityTimeline(current);

    expect(timelineMatchesOperation(timeline, current, "session-1", 3)).toBe(true);
    expect(timelineMatchesOperation(timeline, current, "session-2", 3)).toBe(false);
    expect(timelineMatchesOperation(timeline, { ...current, operationId: "other" }, "session-1", 3)).toBe(false);
  });
});

function operation(): OperationView {
  return {
    operationId: "operation-1",
    kind: "prompt",
    lifecycle: "running",
    cancellable: true,
    sessionId: "session-1",
    sessionFileIdentity: "session-file-1",
    sessionGeneration: 3,
    startedAt: 10
  };
}
