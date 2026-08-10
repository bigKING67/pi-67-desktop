import type { AgentConnectionIdentity } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";

const CONNECTION: AgentConnectionIdentity = {
  appInstanceId: "app-1",
  hostInstanceId: "host-1",
  hostEpoch: 1,
  sdkVersion: "0.83.0",
  eventSequence: 0
};

describe("initial Agent Host connection state", () => {
  beforeEach(resetStores);
  afterEach(() => {
    vi.restoreAllMocks();
    resetStores();
  });

  it("clears a stale connection-recovery status after the first successful handshake", () => {
    registerWorkspaceAndSelectColdSession();
    useAppStore.setState({
      workspace: "/workspace",
      connected: false,
      hostEpoch: undefined,
      runtime: {
        phase: "recovering",
        detail: "Pi 运行服务连接已中断，正在等待恢复",
        recoverable: true
      }
    });

    useAppStore.getState().handleAgentConnected(CONNECTION);

    expect(useAppStore.getState()).toMatchObject({
      connected: true,
      hostEpoch: 1,
      sessionTransitionPending: false,
      runtime: { phase: "stopped", detail: "会话待打开" }
    });
  });

  it("does not overwrite a caller-owned first-connection transition", () => {
    registerWorkspaceAndSelectColdSession();
    useAppStore.setState({
      workspace: "/workspace",
      connected: false,
      hostEpoch: undefined,
      sessionTransitionPending: true,
      runtime: {
        phase: "recovering",
        detail: "正在恢复 Pi 会话",
        recoverable: true
      }
    });

    useAppStore.getState().handleAgentConnected(CONNECTION);

    expect(useAppStore.getState().runtime).toMatchObject({
      phase: "recovering",
      detail: "正在恢复 Pi 会话"
    });
  });
});

function registerWorkspaceAndSelectColdSession(): void {
  const workbench = rendererWorkbenchStore.getState();
  workbench.registerWorkspace({
    id: "workspace-1",
    displayName: "Workspace",
    identity: { canonicalPath: "/workspace", assurance: "filesystem" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  });
  workbench.selectConversation({
    kind: "session",
    workspaceId: "workspace-1",
    sessionFileIdentity: "session-file-1",
    sessionPath: "/sessions/session-1.jsonl"
  });
}

function resetStores(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  rendererWorkbenchStore.getState().reset();
}
