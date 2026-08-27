import type { SessionSnapshot } from "@pi67/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { useApprovalStore } from "../approval/approval-store.js";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { agentConnectionController } from "./AgentConnectionController.js";
import { seedAuthoritativeRecoveryTask } from "./projection-recovery-test-support.js";

describe("same-Host Session recovery failure", () => {
  beforeEach(() => {
    resetStores();
    seedAuthoritativeRecoveryTask();
    useAppStore.setState({
      workspace: "/workspace",
      connected: false,
      connectionIdentity: undefined,
      hostEpoch: 9,
      runtime: { phase: "recovering", detail: "等待恢复", recoverable: true }
    });
    installSessionProjectionFixture(
      { connected: true, hostEpoch: 9 },
      snapshot(),
      3
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetStores();
  });

  it("settles the current transition when projection resync is rejected", async () => {
    vi.spyOn(agentConnectionController, "resyncProjection").mockResolvedValue(false);

    useAppStore.getState().handleAgentConnected(connectionIdentity());
    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

    expect(rendererWorkbenchStore.getState().tasks["task-1"]).toMatchObject({
      lifecycle: "lost",
      runtime: {
        phase: "failed",
        detail: "无法恢复 Pi 会话：会话恢复结果已过期，请重新打开对话。"
      }
    });
    expect(useAppStore.getState().runtime).toMatchObject({
      phase: "failed",
      detail: "无法恢复 Pi 会话：会话恢复结果已过期，请重新打开对话。"
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法恢复 Pi 会话",
      message: "会话恢复结果已过期，请重新打开对话。"
    });
  });
});

function snapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    sessionFileIdentity: "session-file-session-1",
    sessionPath: "/sessions/session-1.jsonl",
    cwd: "/workspace",
    streaming: false,
    messages: [],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [],
    providers: [],
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: []
  };
}

function connectionIdentity() {
  return {
    appInstanceId: "app-1",
    hostInstanceId: "host-9",
    hostEpoch: 9,
    sdkVersion: "fixture",
    eventSequence: 0
  };
}

function resetStores(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useApprovalStore.setState(useApprovalStore.getInitialState(), true);
  useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
  useConversationStore.setState(useConversationStore.getInitialState(), true);
  useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
  useLiveTurnStore.setState(useLiveTurnStore.getInitialState(), true);
  useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  useSessionTreeStore.setState(useSessionTreeStore.getInitialState(), true);
  rendererWorkbenchStore.getState().reset();
}
