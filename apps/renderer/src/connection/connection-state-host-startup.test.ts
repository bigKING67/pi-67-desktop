import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { INITIAL_RUNTIME_STATE } from "../app/app-state-projection.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { resetAgentHostStartupStateForTest } from "./agent-host-startup-state.js";

describe("renderer deterministic Agent Host startup failure", () => {
  beforeEach(() => {
    resetAgentHostStartupStateForTest();
    useNotificationStore.getState().clear();
    useAppStore.setState({
      connectionIdentity: undefined,
      hostEpoch: undefined,
      connected: false,
      runtime: INITIAL_RUNTIME_STATE,
      workspace: "/workspace",
      trustUpdating: false,
      sessionTransitionPending: false,
      sessionBootstrapTransitionPending: false
    });
  });

  it("presents one root failure instead of a restart or downstream failure storm", () => {
    const state = {
      hostEpoch: 3,
      code: 1,
      recoverable: false,
      startupFailure: {
        type: "agent-host-startup-failed" as const,
        profileMode: "existing-shared" as const,
        issue: { stage: "server-construction" as const, code: "unknown" as const }
      }
    };

    useAppStore.getState().handleAgentHostFailed(state);
    useAppStore.getState().handleAgentHostFailed(state);

    expect(useAppStore.getState().runtime).toEqual({
      phase: "failed",
      detail: "Pi 运行服务启动失败，现有 Pi 配置未被删除或覆盖",
      recoverable: false
    });
    expect(useNotificationStore.getState().items).toHaveLength(1);
    expect(useNotificationStore.getState().items[0]).toMatchObject({
      level: "warning",
      title: "Pi 运行服务启动失败"
    });
  });
});
