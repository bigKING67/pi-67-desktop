import type { OperationView, SessionSnapshot } from "@pi67/domain";
import type { ProjectionResyncInstaller, ProjectionResyncResult } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApprovalStore } from "../approval/approval-store.js";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useOperationActivityTimelineStore } from "../operation/operation-activity-timeline-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import { useAppStore } from "./app-store.js";

describe("renderer interactive projection resync", () => {
  beforeEach(() => {
    resetStores();
    const authority = installSessionProjectionFixture(useAppStore.getState(), snapshot(), 3);
    if (!authority) throw new Error("Expected Session projection fixture authority.");
    useWorkspaceChangesStore.getState().beginSession(authority);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetStores();
  });

  it("clears pending Approval and Extension UI before restoring the Host base Operation", async () => {
    const activeOperation = runningToolOperation();
    useAppStore.setState({ operation: activeOperation });
    useApprovalStore.getState().upsertRequest({
      requestId: "approval-gap",
      toolCallId: "tool-gap",
      toolName: "edit",
      toolSource: "Pi 内置",
      category: "workspace-write",
      reason: "Confirm edit",
      targetKind: "path",
      target: "src/file.ts",
      targetTruncated: false,
      cwd: "/workspace",
      cwdTruncated: false,
      scope: "single-tool-call",
      hostEpoch: 9,
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: activeOperation.operationId
    });
    useExtensionUiStore.getState().upsertRequest({
      requestId: "extension-gap",
      kind: "input",
      title: "Value",
      blocking: true,
      hostEpoch: 9,
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: activeOperation.operationId
    });
    let resolveResync!: (result: ProjectionResyncResult) => void;
    vi.spyOn(agentConnectionController, "resyncProjection").mockImplementation((install) => new Promise((resolve) => {
      resolveResync = (result) => resolve(install(result));
    }));
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(emptyCatalogPage() as never);

    useAppStore.getState().handleSequenceGap({ expected: 2, received: 10, hostEpoch: 9 });

    expect(useApprovalStore.getState().requests).toEqual([]);
    expect(useExtensionUiStore.getState().requests).toEqual([]);
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: true,
      runtime: { phase: "recovering" }
    });

    resolveResync({
      snapshot: { ...snapshot(), streaming: true },
      changes: emptyChanges(),
      extensionCatalog: { items: [], total: 0, truncated: false },
      sessionCatalogStatus: readyCatalogStatus(),
      eventSequence: 10,
      hostEpoch: 9,
      sessionGeneration: 3,
      taskToolMode: "auto",
      activeOperation
    });
    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

    expect(useApprovalStore.getState().requests).toEqual([]);
    expect(useExtensionUiStore.getState().requests).toEqual([]);
    expect(useAppStore.getState().operation).toEqual(activeOperation);
    expect(useAppStore.getState().runtime.phase).toBe("busy");
    expect(useOperationActivityTimelineStore.getState().timeline?.steps).toMatchObject([{
      activity: activeOperation.activity,
      status: "running"
    }]);
  });

  it("allows only the latest Renderer recovery attempt to install its projection", async () => {
    useAppStore.setState({ workspace: "/workspace" });
    const pending: Array<{
      install: ProjectionResyncInstaller;
      resolve: (committed: boolean) => void;
    }> = [];
    vi.spyOn(agentConnectionController, "resyncProjection").mockImplementation((install) => new Promise((resolve) => {
      pending.push({ install, resolve });
    }));
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(emptyCatalogPage() as never);

    useAppStore.getState().handleSequenceGap({ expected: 2, received: 10, hostEpoch: 9 });
    useAppStore.getState().handlePowerResume();
    expect(pending).toHaveLength(2);

    const latestInstalled = pending[1]!.install(resyncResult(11));
    pending[1]!.resolve(latestInstalled);
    await vi.waitFor(() => expect(useAppStore.getState().runtime).toMatchObject({
      phase: "ready",
      detail: "系统恢复后 Pi 状态已重新同步"
    }));

    const staleInstalled = pending[0]!.install({
      ...resyncResult(10),
      activeOperation: runningToolOperation()
    });
    pending[0]!.resolve(staleInstalled);
    await Promise.resolve();

    expect(latestInstalled).toBe(true);
    expect(staleInstalled).toBe(false);
    expect(useAppStore.getState().operation).toBeUndefined();
    expect(useAppStore.getState().runtime.detail).toBe("系统恢复后 Pi 状态已重新同步");
  });

  it("fails recovery without accepting an internally inconsistent projection", async () => {
    vi.spyOn(agentConnectionController, "resyncProjection").mockImplementation(async (install) => install({
      ...resyncResult(10),
      changes: { ...emptyChanges(), sessionId: "session-other" }
    }));

    useAppStore.getState().handleSequenceGap({ expected: 2, received: 10, hostEpoch: 9 });
    await vi.waitFor(() => expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      runtime: {
        phase: "failed",
        detail: expect.stringContaining("Projection resync returned changes for a different Session")
      }
    }));
  });
});

function resetStores(): void {
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    connected: true,
    hostEpoch: 9
  }, true);
  useApprovalStore.setState(useApprovalStore.getInitialState(), true);
  useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
  useConversationStore.setState(useConversationStore.getInitialState(), true);
  useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
  useLiveTurnStore.setState(useLiveTurnStore.getInitialState(), true);
  useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
  useOperationActivityTimelineStore.setState(useOperationActivityTimelineStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  useSessionTreeStore.setState(useSessionTreeStore.getInitialState(), true);
}

function runningToolOperation(): OperationView {
  return {
    operationId: "operation-interactive-gap",
    kind: "prompt",
    lifecycle: "running",
    cancellable: true,
    sessionId: "session-1",
    sessionGeneration: 3,
    startedAt: 1,
    activity: {
      kind: "tool",
      toolCallId: "tool-gap",
      toolName: "edit",
      toolKind: "edit",
      status: "running"
    }
  };
}

function snapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
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

function emptyChanges() {
  return { sessionId: "session-1", items: [], truncated: false, total: 0 };
}

function resyncResult(eventSequence: number): ProjectionResyncResult {
  return {
    snapshot: snapshot(),
    changes: emptyChanges(),
    extensionCatalog: { items: [], total: 0, truncated: false },
    sessionCatalogStatus: readyCatalogStatus(),
    eventSequence,
    hostEpoch: 9,
    sessionGeneration: 3,
    taskToolMode: "auto"
  };
}

function readyCatalogStatus() {
  return {
    revision: 2,
    itemCount: 1,
    source: "sqlite" as const,
    state: "ready" as const,
    rebuilding: false,
    incomplete: false,
    skippedCount: 0
  };
}

function emptyCatalogPage() {
  return { ...readyCatalogStatus(), items: [], total: 0, hasMore: false };
}
