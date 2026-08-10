import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { seedAuthoritativeRecoveryTask } from "./projection-recovery-test-support.js";
import { agentConnectionController } from "./AgentConnectionController.js";

describe("power-resume projection authority", () => {
  beforeEach(resetStores);
  afterEach(() => {
    vi.restoreAllMocks();
    resetStores();
  });

  it("skips projection resync when no Task Runtime is active", () => {
    useAppStore.setState({
      workspace: "/workspace",
      connected: true,
      hostEpoch: 9,
      runtime: { phase: "stopped", detail: "会话未在运行，打开后可继续。", recoverable: true }
    });
    const resync = vi.spyOn(agentConnectionController, "resyncProjection");

    useAppStore.getState().handlePowerResume();

    expect(resync).not.toHaveBeenCalled();
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      runtime: { phase: "stopped", detail: "会话未在运行，打开后可继续。" }
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("uses the matching physical Session Task authority for resync", async () => {
    seedAuthoritativeRecoveryTask();
    useSessionProjectionStore.setState({
      authority: {
        phase: "active",
        hostEpoch: 9,
        sessionId: "session-1",
        sessionFileIdentity: "session-file-session-1",
        sessionGeneration: 3,
        projectionRevision: 1
      },
      recoverySessionFileIdentity: "session-file-session-1"
    });
    useAppStore.setState({ workspace: "/workspace", connected: true, hostEpoch: 9 });
    const resync = vi.spyOn(agentConnectionController, "resyncProjection")
      .mockResolvedValue(false);

    useAppStore.getState().handlePowerResume();

    await vi.waitFor(() => expect(resync).toHaveBeenCalledOnce());
    expect(resync).toHaveBeenCalledWith(expect.any(Function), {
      scope: "task",
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskGeneration: 1,
      sessionId: "session-1",
      sessionFileIdentity: "session-file-session-1",
      sessionGeneration: 3
    });
  });
});

function resetStores(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  rendererWorkbenchStore.getState().reset();
}
