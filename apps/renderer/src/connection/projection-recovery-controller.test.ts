import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtocolRequestError } from "@pi67/protocol";
import { useAppStore } from "../app/app-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { prepareRendererSessionTransaction } from "../app/renderer-session-transaction.js";
import { agentConnectionController } from "./AgentConnectionController.js";
import {
  invalidateProjectionRecoveryGeneration,
  resynchronizeRendererProjection
} from "./projection-recovery-controller.js";

describe("projection recovery controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    rendererWorkbenchStore.getState().reset();
    useAppStore.setState({
      connected: true,
      connectionIdentity: {
        appInstanceId: "app",
        hostInstanceId: "host",
        hostEpoch: 9,
        sdkVersion: "fixture",
        eventSequence: 0
      },
      hostEpoch: 9,
      workspace: "/work/a",
      trust: "trusted"
    });
  });

  it("defers an absent Runtime to Session bootstrap without showing a false recovery error", async () => {
    vi.spyOn(agentConnectionController, "resyncProjection").mockRejectedValue(runtimeNotReady());

    await expect(resynchronizeRendererProjection(useAppStore.getState, useAppStore.setState, {
      hostEpoch: 9,
      recoveringDetail: "reattaching",
      readyDetail: "ready",
      failureTitle: "无法恢复任务",
      deferRuntimeNotReady: true
    })).resolves.toBe("runtime-not-ready");

    expect(useAppStore.getState().sessionTransitionPending).toBe(false);
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("still reports Runtime-not-ready failures for ordinary projection recovery", async () => {
    vi.spyOn(agentConnectionController, "resyncProjection").mockRejectedValue(runtimeNotReady());

    await expect(resynchronizeRendererProjection(useAppStore.getState, useAppStore.setState, {
      hostEpoch: 9,
      recoveringDetail: "reattaching",
      readyDetail: "ready",
      failureTitle: "无法重新同步"
    })).resolves.toBe("failed");

    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      runtime: { phase: "failed" }
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      title: "无法重新同步"
    });
  });

  it("settles a stale recovery when no newer recovery generation owns the transition", async () => {
    vi.spyOn(agentConnectionController, "resyncProjection").mockResolvedValue(false);

    await expect(resynchronizeRendererProjection(useAppStore.getState, useAppStore.setState, {
      hostEpoch: 9,
      recoveringDetail: "reattaching",
      readyDetail: "ready",
      failureTitle: "无法恢复任务"
    })).resolves.toBe("failed");

    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      runtime: {
        phase: "failed",
        detail: "无法恢复任务：会话恢复结果已过期，请重新打开对话。"
      }
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法恢复任务",
      message: "会话恢复结果已过期，请重新打开对话。"
    });
  });

  it("does not settle a stale recovery after a newer recovery generation takes ownership", async () => {
    vi.spyOn(agentConnectionController, "resyncProjection").mockImplementation(async () => {
      invalidateProjectionRecoveryGeneration();
      useAppStore.setState({
        sessionTransitionPending: true,
        runtime: { phase: "recovering", detail: "Newer recovery", recoverable: true }
      });
      return false;
    });

    await expect(resynchronizeRendererProjection(useAppStore.getState, useAppStore.setState, {
      hostEpoch: 9,
      recoveringDetail: "reattaching",
      readyDetail: "ready",
      failureTitle: "无法恢复任务"
    })).resolves.toBe("stale");

    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: true,
      runtime: { phase: "recovering", detail: "Newer recovery" }
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("does not settle a stale recovery after a newer Session transaction takes ownership", async () => {
    vi.spyOn(agentConnectionController, "resyncProjection").mockImplementation(async () => {
      prepareRendererSessionTransaction("host-replaced");
      useAppStore.setState({
        sessionTransitionPending: true,
        runtime: { phase: "recovering", detail: "Newer Session transaction", recoverable: true }
      });
      return false;
    });

    await expect(resynchronizeRendererProjection(useAppStore.getState, useAppStore.setState, {
      hostEpoch: 9,
      recoveringDetail: "reattaching",
      readyDetail: "ready",
      failureTitle: "无法恢复任务"
    })).resolves.toBe("stale");

    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: true,
      runtime: { phase: "recovering", detail: "Newer Session transaction" }
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });
});

function runtimeNotReady(): ProtocolRequestError {
  return new ProtocolRequestError({
    code: "RUNTIME_NOT_READY",
    message: "Task Runtime is not initialized.",
    recoverable: true
  });
}
