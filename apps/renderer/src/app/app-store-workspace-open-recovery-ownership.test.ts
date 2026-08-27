import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApprovalStore } from "../approval/approval-store.js";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { invalidateProjectionRecoveryGeneration } from "../connection/projection-recovery-controller.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { resetWorkspaceHostRegistrationState } from "../workbench/workspace-host-registration-controller.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import { useAppStore } from "./app-store.js";
import { prepareRendererSessionTransaction } from "./renderer-session-transaction.js";
import {
  workspaceConnectionIdentity,
  workspaceDescriptorFixture
} from "./workspace-open-test-fixtures.js";

describe("Workspace open recovery ownership", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ connected: true, hostEpoch: 9 });
    vi.spyOn(agentConnectionController, "identity", "get")
      .mockReturnValue(workspaceConnectionIdentity(9));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetStores();
  });

  it("settles a current Session resync rejection instead of leaving recovery pending", async () => {
    const descriptor = workspaceDescriptorFixture("workspace-stale", "/workspace-stale");
    const sessionPath = "/sessions/stale-target.jsonl";
    const sessionFileIdentity = "session-file-stale-target";
    rendererWorkbenchStore.getState().registerWorkspace(descriptor);
    vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.register") return { registered: true } as never;
      if (type === "runtime.initialize") {
        return projectionAcknowledgement("session-stale-target", 1) as never;
      }
      if (type === "session.catalog.query") return emptyCatalogPage() as never;
      throw new Error(`Unexpected request: ${type}`);
    });
    vi.spyOn(agentConnectionController, "resyncProjection").mockResolvedValue(false);

    await expect(openRendererWorkspaceDescriptor(descriptor, sessionPath, sessionFileIdentity))
      .resolves.toBe(false);

    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      workspaceOpenPending: false,
      runtime: {
        phase: "failed",
        detail: "无法打开对话：会话恢复结果已过期，请重新打开对话。"
      }
    });
    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([
      expect.objectContaining({
        lifecycle: "lost",
        runtime: { phase: "failed", detail: expect.any(String), recoverable: true }
      })
    ]);
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法打开对话",
      message: "会话恢复结果已过期，请重新打开对话。"
    });
  });

  it("preserves a newer recovery when it supersedes a stale Session open", async () => {
    const descriptor = workspaceDescriptorFixture("workspace-superseded", "/workspace-superseded");
    const sessionPath = "/sessions/superseded-target.jsonl";
    const sessionFileIdentity = "session-file-superseded-target";
    rendererWorkbenchStore.getState().registerWorkspace(descriptor);
    vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.register") return { registered: true } as never;
      if (type === "runtime.initialize") {
        invalidateProjectionRecoveryGeneration();
        prepareRendererSessionTransaction("host-replaced");
        useAppStore.setState({
          sessionTransitionPending: true,
          runtime: { phase: "recovering", detail: "Newer recovery", recoverable: true }
        });
        return projectionAcknowledgement("session-superseded-target", 1) as never;
      }
      if (type === "session.catalog.query") return emptyCatalogPage() as never;
      throw new Error(`Unexpected request: ${type}`);
    });

    await expect(openRendererWorkspaceDescriptor(descriptor, sessionPath, sessionFileIdentity))
      .resolves.toBe(false);

    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: true,
      workspaceOpenPending: false,
      runtime: { phase: "recovering", detail: "Newer recovery" }
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });
});

function projectionAcknowledgement(sessionId: string, sessionGeneration: number) {
  return {
    accepted: true as const,
    hostEpoch: 9,
    sessionId,
    sessionGeneration,
    eventSequence: 2
  };
}

function emptyCatalogPage() {
  return {
    revision: 1,
    itemCount: 0,
    source: "sqlite" as const,
    state: "ready" as const,
    rebuilding: false,
    incomplete: false,
    skippedCount: 0,
    items: [],
    total: 0,
    hasMore: false
  };
}

function resetStores(): void {
  resetWorkspaceHostRegistrationState();
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
