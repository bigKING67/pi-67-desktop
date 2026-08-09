import { describe, expect, it } from "vitest";
import {
  isActiveOperationLifecycle,
  operationPresentation
} from "./TurnActivity.js";
import { createOperationActivityTimeline } from "./operation-activity-timeline-store.js";
import {
  hasVisibleOperationTimeline,
  hasVisibleTurnActivity
} from "./turn-activity-visibility.js";

describe("TurnActivity projection", () => {
  it("shows a non-terminal quiet warning while preserving an active lifecycle", () => {
    const presentation = operationPresentation("prompt", "running", undefined, "quiet", undefined);

    expect(presentation).toMatchObject({
      label: "暂时没有新活动",
      detail: "Pi 运行服务仍在响应，可以继续等待或停止任务"
    });
    expect(isActiveOperationLifecycle("running")).toBe(true);
    expect(presentation.label).not.toBe("任务失败");
  });

  it("shows heartbeat recovery intent without fabricating failure", () => {
    const presentation = operationPresentation("prompt", "running", undefined, "stalled", undefined);

    expect(presentation).toMatchObject({
      label: "正在确认任务状态",
      detail: "正在确认任务仍由当前 Host 执行"
    });
    expect(isActiveOperationLifecycle("running")).toBe(true);
    expect(presentation.label).not.toBe("任务失败");
  });

  it("names the real tool presentation kind instead of collapsing all tools", () => {
    expect(operationPresentation("prompt", "running", {
      kind: "tool",
      toolCallId: "tool-shell",
      toolName: "bash",
      toolKind: "shell",
      status: "running"
    }, undefined, undefined).label).toBe("正在调用 bash");
    expect(operationPresentation("prompt", "running", {
      kind: "tool",
      toolCallId: "tool-search",
      toolName: "web_search",
      toolKind: "search",
      status: "running"
    }, undefined, undefined).label).toBe("正在调用 web_search");
  });

  it("uses conservative delegated Tool copy for every real terminal status", () => {
    const activity = {
      kind: "tool" as const,
      toolCallId: "delegated-1",
      toolName: "delegate_task",
      toolKind: "subagent" as const
    };

    expect(operationPresentation(
      "prompt",
      "running",
      { ...activity, status: "running" },
      undefined,
      undefined
    ).label).toBe("正在执行委派工具");
    expect(operationPresentation(
      "prompt",
      "running",
      { ...activity, status: "completed" },
      undefined,
      undefined
    ).label).toBe("委派工具已完成");
    expect(operationPresentation(
      "prompt",
      "running",
      { ...activity, status: "failed" },
      undefined,
      undefined
    ).label).toBe("委派工具执行失败");
  });

  it("hides completed activity but keeps terminal failures and recovery visible", () => {
    const completed = {
      operationId: "operation-completed",
      kind: "prompt" as const,
      lifecycle: "completed" as const,
      cancellable: false,
      sessionId: "session",
      sessionFileIdentity: "session-file",
      sessionGeneration: 1,
      startedAt: 1
    };
    expect(hasVisibleTurnActivity("ready", completed)).toBe(false);
    expect(hasVisibleTurnActivity("ready", { ...completed, lifecycle: "failed" })).toBe(true);
    expect(hasVisibleTurnActivity("recovering", completed)).toBe(true);
    expect(hasVisibleTurnActivity("recovering", completed, "new-session", 2)).toBe(false);
  });

  it("keeps a matching completed timeline available as a collapsed summary", () => {
    const completed = {
      operationId: "operation-completed",
      kind: "prompt" as const,
      lifecycle: "completed" as const,
      cancellable: false,
      sessionId: "session",
      sessionFileIdentity: "session-file",
      sessionGeneration: 1,
      startedAt: 1
    };
    const timeline = createOperationActivityTimeline(completed);

    expect(hasVisibleOperationTimeline(timeline, completed, "session", 1)).toBe(true);
    expect(hasVisibleOperationTimeline(timeline, completed, "other", 1)).toBe(false);
  });
});
