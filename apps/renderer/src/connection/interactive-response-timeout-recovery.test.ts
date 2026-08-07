import type { OperationView } from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { recoverInteractiveResponseTimeout } from "./interactive-response-timeout-recovery.js";

const resynchronize = vi.hoisted(() => vi.fn());

vi.mock("./projection-recovery-controller.js", () => ({
  resynchronizeRendererProjection: resynchronize
}));

const operation: OperationView = {
  operationId: "operation-1",
  kind: "prompt",
  lifecycle: "waiting-input",
  cancellable: true,
  sessionId: "session-1",
  sessionFileIdentity: "session-file-session-1",
  sessionGeneration: 3,
  startedAt: 1
};

describe("interactive response timeout recovery", () => {
  beforeEach(() => {
    resynchronize.mockReset().mockResolvedValue(undefined);
    useAppStore.setState({
      ...useAppStore.getInitialState(),
      connected: true,
      hostEpoch: 9,
      operation
    }, true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
  });

  it("resynchronizes the authoritative projection after an approval acknowledgement timeout", async () => {
    await expect(recoverInteractiveResponseTimeout(requestTimeout(), {
      kind: "approval",
      hostEpoch: 9,
      operationId: "operation-1"
    })).resolves.toBe(true);

    expect(resynchronize).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      {
        hostEpoch: 9,
        operationId: "operation-1",
        recoveringDetail: "授权响应确认超时，正在重新同步 Pi 状态",
        readyDetail: "授权状态已重新同步",
        failureTitle: "无法确认授权结果"
      }
    );
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "授权结果需要重新确认",
      message: "Pi 运行服务未在同步边界内确认响应；正在重新同步。未确认的授权不会放行。"
    });
  });

  it("uses the same fail-closed recovery for an Extension response", async () => {
    await expect(recoverInteractiveResponseTimeout(requestTimeout(), {
      kind: "extension",
      hostEpoch: 9,
      operationId: "operation-1"
    })).resolves.toBe(true);

    expect(resynchronize).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        recoveringDetail: "Extension 响应确认超时，正在重新同步 Pi 状态",
        readyDetail: "Extension 输入状态已重新同步",
        failureTitle: "无法确认 Extension 响应"
      })
    );
  });

  it("does not start recovery for unrelated failures or stale authority", async () => {
    await expect(recoverInteractiveResponseTimeout(new Error("closed"), {
      kind: "approval",
      hostEpoch: 9,
      operationId: "operation-1"
    })).resolves.toBe(false);
    await expect(recoverInteractiveResponseTimeout(requestTimeout(), {
      kind: "approval",
      hostEpoch: 8,
      operationId: "operation-1"
    })).resolves.toBe(false);

    expect(resynchronize).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().items).toEqual([]);
  });
});

function requestTimeout(): ProtocolRequestError {
  return new ProtocolRequestError({
    code: "REQUEST_TIMEOUT",
    message: "Agent request acknowledgement timed out: approval.respond",
    recoverable: true
  });
}
