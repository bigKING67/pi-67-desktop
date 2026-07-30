import { describe, expect, it } from "vitest";
import {
  hasVisibleTurnActivity,
  isActiveOperationLifecycle,
  operationPresentation
} from "./TurnActivity.js";

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

  it("hides completed activity but keeps terminal failures and recovery visible", () => {
    const completed = {
      operationId: "operation-completed",
      kind: "prompt" as const,
      lifecycle: "completed" as const,
      cancellable: false,
      sessionId: "session",
      sessionGeneration: 1,
      startedAt: 1
    };
    expect(hasVisibleTurnActivity("ready", completed)).toBe(false);
    expect(hasVisibleTurnActivity("ready", { ...completed, lifecycle: "failed" })).toBe(true);
    expect(hasVisibleTurnActivity("recovering", completed)).toBe(true);
    expect(hasVisibleTurnActivity("recovering", completed, "new-session", 2)).toBe(false);
  });
});
