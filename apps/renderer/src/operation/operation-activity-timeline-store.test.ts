import type { OperationView } from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createOperationActivityTimeline,
  createResynchronizedOperationActivityTimeline,
  finishOperationActivityTimeline,
  recordOperationTimelineActivity,
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
    sessionGeneration: 3,
    startedAt: 10
  };
}
