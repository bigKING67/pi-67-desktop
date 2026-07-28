import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtocolRequestError } from "@pi67/protocol";
import { useAppStore } from "../app/app-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { agentConnectionController } from "./AgentConnectionController.js";
import { resynchronizeRendererProjection } from "./projection-recovery-controller.js";

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
});

function runtimeNotReady(): ProtocolRequestError {
  return new ProtocolRequestError({
    code: "RUNTIME_NOT_READY",
    message: "Task Runtime is not initialized.",
    recoverable: true
  });
}
