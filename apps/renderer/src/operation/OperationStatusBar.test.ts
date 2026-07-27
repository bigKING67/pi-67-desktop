import { describe, expect, it } from "vitest";
import {
  isActiveOperationLifecycle,
  operationPresentation
} from "./OperationStatusBar.js";

describe("OperationStatusBar freshness projection", () => {
  it("shows a non-terminal quiet warning while preserving Stop", () => {
    const presentation = operationPresentation("prompt", "running", undefined, "quiet", undefined);

    expect(presentation).toMatchObject({
      label: "任务暂时没有新活动",
      detail: "Agent Host 仍在响应，可以继续等待或停止任务"
    });
    expect(isActiveOperationLifecycle("running")).toBe(true);
    expect(presentation.label).not.toBe("任务失败");
  });

  it("shows heartbeat stall recovery intent without fabricating failure", () => {
    const presentation = operationPresentation("prompt", "running", undefined, "stalled", undefined);

    expect(presentation).toMatchObject({
      label: "Agent Host 心跳延迟",
      detail: "正在确认任务仍由当前 Host 执行"
    });
    expect(isActiveOperationLifecycle("running")).toBe(true);
    expect(presentation.label).not.toBe("任务失败");
  });
});
