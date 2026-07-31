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
      toolKind: "shell"
    }, 30);

    expect(timeline.steps).toMatchObject([
      { activity: undefined, status: "completed", settledAt: 20 },
      { activity: { kind: "thinking" }, status: "completed", settledAt: 30 },
      { activity: { kind: "tool", toolCallId: "tool-1", toolKind: "shell" }, status: "running" }
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
      activity: { kind: "tool", toolCallId: "tool-current", toolKind: "edit" } as const
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
