import type { OperationKind, OperationView, SessionSnapshot, WorkspaceChangesProjection } from "@pi67/domain";
import type { OperationSettled, ProjectionResyncResult } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useApprovalStore } from "../approval/approval-store.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useAppStore } from "./app-store.js";

describe("renderer Operation recovery", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.getState().handleAgentHostFailed({ code: 1, recoverable: false });
    resetStores();
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(emptyCatalogPage() as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetStores();
  });

  it("does not carry an interrupted Operation from a workspace-free teardown", async () => {
    const stale = runningOperation("operation-without-workspace");
    useAppStore.setState({
      connected: true,
      hostEpoch: 9,
      operation: stale
    });
    useAppStore.getState().handleAgentTeardown(new Error("Port closed"));

    useAppStore.setState({ workspace: "/workspace" });
    mockProjectionResync(
      resyncResult({ latestOperationTerminal: terminalReceipt(stale.operationId) })
    );

    useAppStore.getState().handleAgentConnected(connectionIdentity(9));
    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

    expect(useAppStore.getState().operation).toBeUndefined();
    expect(useAppStore.getState().runtime).toMatchObject({
      phase: "ready",
      detail: "Pi 会话已恢复"
    });
  });

  it("restores a failed terminal receipt with its error notice", async () => {
    const running = runningOperation("operation-failed", "command");
    const terminal = terminalReceipt(running.operationId, "command", "failed");
    mockProjectionResync(
      resyncResult({ latestOperationTerminal: terminal })
    );
    prepareInterruptedOperation(running);

    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

    expect(useAppStore.getState().operation).toMatchObject({
      operationId: running.operationId,
      lifecycle: "failed",
      cancellable: false
    });
    expect(useAppStore.getState().runtime).toMatchObject({ phase: "failed", detail: "Structured failure" });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "任务失败",
      message: "Pi 命令 · 错误代码 INTERNAL"
    });
  });

  it("restores a lost terminal receipt as recoverable interruption", async () => {
    const running = runningOperation("operation-lost", "prompt");
    const terminal = terminalReceipt(running.operationId, "prompt", "lost");
    mockProjectionResync(
      resyncResult({ latestOperationTerminal: terminal })
    );
    prepareInterruptedOperation(running);

    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

    expect(useAppStore.getState().operation).toMatchObject({ lifecycle: "lost", cancellable: false });
    expect(useAppStore.getState().runtime).toMatchObject({ phase: "recovering", detail: "Runtime replaced" });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "任务已中断",
      message: "Pi 任务 · Pi 运行服务未能确认任务终态"
    });
  });

  it("ignores an unrelated latest terminal receipt", async () => {
    mockProjectionResync(
      resyncResult({ latestOperationTerminal: terminalReceipt("operation-unrelated") })
    );
    prepareInterruptedOperation(runningOperation("operation-current"));

    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

    expect(useAppStore.getState().operation).toBeUndefined();
    expect(useAppStore.getState().runtime).toMatchObject({ phase: "ready", detail: "Pi 状态已重新同步" });
  });

  it("does not replace a prior terminal Operation with unrelated resync history", async () => {
    const completed = operationFromTerminal(terminalReceipt("operation-already-completed"));
    useAppStore.setState({
      workspace: "/workspace",
      connected: true,
      hostEpoch: 9,
      operation: completed,
      operationDetail: "任务已完成"
    });
    mockProjectionResync(
      resyncResult({ latestOperationTerminal: terminalReceipt("operation-unrelated") })
    );

    useAppStore.getState().handleSequenceGap({ expected: 2, received: 10, hostEpoch: 9 });
    await vi.waitFor(() => expect(useAppStore.getState().sessionTransitionPending).toBe(false));

    expect(useAppStore.getState().operation).toBeUndefined();
    expect(useAppStore.getState().runtime.phase).toBe("ready");
  });
});

function prepareInterruptedOperation(operation: OperationView): void {
  useAppStore.setState({
    workspace: "/workspace",
    connected: true,
    hostEpoch: 9,
    operation
  });
  useAppStore.getState().handleSequenceGap({ expected: 2, received: 10, hostEpoch: 9 });
}

function resyncResult(overrides: Partial<ProjectionResyncResult> = {}): ProjectionResyncResult {
  return {
    snapshot: snapshot(),
    changes: emptyChanges(),
    extensionCatalog: { items: [], total: 0, truncated: false },
    sessionCatalogStatus: readyCatalogStatus(),
    eventSequence: 10,
    hostEpoch: 9,
    sessionGeneration: 3,
    taskToolMode: "auto",
    ...overrides
  };
}

function mockProjectionResync(result: ProjectionResyncResult) {
  return vi.spyOn(agentConnectionController, "resyncProjection").mockImplementation(async (install) => install(result));
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

function emptyChanges(): WorkspaceChangesProjection {
  return { sessionId: "session-1", items: [], truncated: false, total: 0 };
}

function runningOperation(operationId: string, kind: OperationKind = "command"): OperationView {
  return {
    operationId,
    kind,
    lifecycle: "running",
    cancellable: true,
    sessionId: "session-1",
    sessionGeneration: 3,
    startedAt: 10
  };
}

function terminalReceipt(
  operationId: string,
  operationKind: OperationKind = "command",
  lifecycle: OperationSettled["lifecycle"] = "completed"
): OperationSettled {
  const base = {
    kind: "settled" as const,
    operationId,
    operationKind,
    cancellable: false as const,
    hostEpoch: 9,
    sessionId: "session-1",
    sessionGeneration: 3,
    startedAt: 10,
    settledAt: 20
  };
  if (lifecycle === "failed") {
    return {
      ...base,
      lifecycle,
      error: { code: "INTERNAL", message: "Structured failure", recoverable: true }
    };
  }
  if (lifecycle === "cancelled" || lifecycle === "lost") {
    return { ...base, lifecycle, reason: lifecycle === "lost" ? "Runtime replaced" : "Cancelled" };
  }
  return { ...base, lifecycle };
}

function operationFromTerminal(terminal: OperationSettled): OperationView {
  return {
    operationId: terminal.operationId,
    kind: terminal.operationKind,
    lifecycle: terminal.lifecycle,
    cancellable: false,
    sessionId: terminal.sessionId,
    sessionGeneration: terminal.sessionGeneration,
    startedAt: terminal.startedAt
  };
}

function connectionIdentity(hostEpoch: number) {
  return {
    appInstanceId: "app-1",
    hostInstanceId: `host-${hostEpoch}`,
    hostEpoch,
    sdkVersion: "0.81.1",
    eventSequence: 0
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

function resetStores(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useSessionCatalogStore.getState().reset();
  useConversationStore.getState().reset();
  useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
  useApprovalStore.setState(useApprovalStore.getInitialState(), true);
  useLiveTurnStore.getState().reset();
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
  useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
}
