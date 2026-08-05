import type { ApprovalRequestView, ExtensionUiRequestView, OperationView } from "@pi67/domain";
import { eventEnvelope, type EventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { useApprovalStore } from "../approval/approval-store.js";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { handleAgentEvent, type RoutedAgentEvent } from "./app-events.js";

const operation: OperationView = {
  operationId: "operation-1",
  kind: "prompt",
  lifecycle: "running",
  cancellable: true,
  sessionId: "session-1",
  sessionGeneration: 3,
  startedAt: 1
};

const extension: ExtensionUiRequestView = {
  requestId: "extension-1",
  kind: "confirm",
  title: "继续？",
  blocking: true,
  hostEpoch: 9,
  sessionId: "session-1",
  sessionGeneration: 3,
  operationId: "operation-1"
};

const approval: ApprovalRequestView = {
  requestId: "approval-1",
  toolCallId: "tool-1",
  toolName: "grep",
  toolSource: "Pi 内置",
  category: "ambiguous-command",
  reason: "需要确认",
  targetKind: "tool",
  target: "grep",
  targetTruncated: false,
  cwd: "/workspace",
  cwdTruncated: false,
  scope: "single-tool-call",
  hostEpoch: 9,
  sessionId: "session-1",
  sessionGeneration: 3,
  operationId: "operation-1"
};

describe("handleAgentEvent operation activity authority", () => {
  beforeEach(() => {
    useApprovalStore.setState(useApprovalStore.getInitialState(), true);
    useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    installSessionProjectionFixture(
      { connected: true, hostEpoch: 9 },
      snapshot("session-1"),
      3
    );
  });

  it("applies only Host-authored activity changes and clears them explicitly", () => {
    const state = eventState();

    dispatch(state, {
      type: "operation.activityChanged",
      payload: { operationId: "operation-1", activity: { kind: "responding" } }
    }, envelope("operation.activityChanged", {
      operationId: "operation-1",
      activity: { kind: "responding" }
    }));
    expect(state.operation).toMatchObject({ lifecycle: "running", activity: { kind: "responding" } });

    dispatch(state, {
      type: "operation.activityChanged",
      payload: { operationId: "operation-1", activity: null }
    }, envelope("operation.activityChanged", { operationId: "operation-1", activity: null }));
    expect(state.operation).toEqual(operation);
  });

  it("rejects activity after the current Operation becomes terminal", () => {
    const state = eventState();
    state.operation = { ...operation, lifecycle: "completed" };

    dispatch(state, {
      type: "operation.activityChanged",
      payload: { operationId: "operation-1", activity: { kind: "responding" } }
    }, envelope("operation.activityChanged", {
      operationId: "operation-1",
      activity: { kind: "responding" }
    }));

    expect(state.operation).toEqual({ ...operation, lifecycle: "completed" });
  });

  it("removes a resolved Extension request only under its current event authority", () => {
    const state = eventState();
    dispatch(state, { type: "extension.ui.requested", payload: extension }, envelope(
      "extension.ui.requested",
      extension
    ));

    dispatch(state, {
      type: "extension.ui.resolved",
      payload: { requestId: "extension-1", cancelled: false }
    }, envelope("extension.ui.resolved", { requestId: "extension-1", cancelled: false }, 8));
    expect(useExtensionUiStore.getState().requests).toEqual([extension]);

    dispatch(state, {
      type: "extension.ui.resolved",
      payload: { requestId: "extension-1", cancelled: false }
    }, envelope("extension.ui.resolved", { requestId: "extension-1", cancelled: false }));
    expect(useExtensionUiStore.getState().requests).toEqual([]);
  });

  it("clears exact pending interactive requests when their Operation settles", () => {
    const state = eventState();
    const otherApproval = {
      ...approval,
      requestId: "approval-other",
      toolCallId: "tool-other",
      operationId: "operation-other"
    };
    const otherExtension = {
      ...extension,
      requestId: "extension-other",
      operationId: "operation-other"
    };
    useApprovalStore.getState().upsertRequest(approval);
    useApprovalStore.getState().upsertRequest(otherApproval);
    useExtensionUiStore.getState().upsertRequest(extension);
    useExtensionUiStore.getState().upsertRequest(otherExtension);

    dispatch(state, {
      type: "operation.completed",
      payload: { operationId: "operation-1", completedAt: 20 }
    }, envelope("operation.completed", { operationId: "operation-1", completedAt: 20 }));

    expect(useApprovalStore.getState().requests).toEqual([otherApproval]);
    expect(useExtensionUiStore.getState().requests).toEqual([otherExtension]);
  });

  it("records an imported Session terminal under the rebound event authority", () => {
    const state = eventState();
    state.operation = {
      ...operation,
      kind: "session-import",
      sessionId: "session-2",
      sessionGeneration: 7
    };
    installSessionProjectionFixture(
      state,
      snapshot("session-2"),
      7
    );

    dispatch(state, {
      type: "operation.completed",
      payload: { operationId: "operation-1", completedAt: 20 }
    }, eventEnvelope("operation.completed", {
      operationId: "operation-1",
      completedAt: 20
    }, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      sessionId: "session-2",
      sessionGeneration: 7,
      operationId: "operation-1"
    })));

    expect(useNotificationStore.getState().items[0]?.operation).toMatchObject({
      operationId: "operation-1",
      operationKind: "session-import",
      sessionId: "session-2",
      sessionGeneration: 7,
      lifecycle: "completed"
    });
    expect(state.operation).toMatchObject({
      operationId: "operation-1",
      kind: "session-import",
      lifecycle: "completed",
      sessionId: "session-2",
      sessionGeneration: 7
    });
  });

  it("rejects an import terminal until Bootstrap rebinds the Operation authority", () => {
    const state = eventState();
    state.operation = { ...operation, kind: "session-import" };
    installSessionProjectionFixture(state, snapshot("session-2"), 7);

    dispatch(state, {
      type: "operation.completed",
      payload: { operationId: "operation-1", completedAt: 20 }
    }, eventEnvelope("operation.completed", {
      operationId: "operation-1",
      completedAt: 20
    }, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      sessionId: "session-2",
      sessionGeneration: 7,
      operationId: "operation-1"
    })));

    expect(state.operation).toMatchObject({
      kind: "session-import",
      lifecycle: "running",
      sessionId: "session-1",
      sessionGeneration: 3
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("rejects a non-import terminal that does not belong to the Operation Session", () => {
    const state = eventState();
    installSessionProjectionFixture(
      state,
      snapshot("session-2"),
      7
    );

    dispatch(state, {
      type: "operation.completed",
      payload: { operationId: "operation-1", completedAt: 20 }
    }, eventEnvelope("operation.completed", {
      operationId: "operation-1",
      completedAt: 20
    }, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      sessionId: "session-2",
      sessionGeneration: 7,
      operationId: "operation-1"
    })));

    expect(state.operation).toEqual(operation);
    expect(useNotificationStore.getState().items).toEqual([]);
  });
});

function eventState() {
  return {
    connected: true,
    hostEpoch: 9,
    runtime: { phase: "busy" as const, detail: "运行中", recoverable: true },
    operation,
    operationDetail: undefined as string | undefined,
    operationProgress: undefined as string | undefined,
    sessionTransitionPending: false
  };
}

function envelope<T extends EventEnvelope["type"]>(
  type: T,
  payload: EventEnvelope<T>["payload"],
  hostEpoch = 9
): EventEnvelope<T> {
  return eventEnvelope(type, payload, taskEventFixture({
    hostEpoch,
    sequence: 1,
    sessionId: "session-1",
    sessionGeneration: 3,
    operationId: "operation-1"
  }));
}

function dispatch<TState extends ReturnType<typeof eventState>>(
  state: TState,
  event: RoutedAgentEvent,
  eventEnvelopeValue: EventEnvelope
): void {
  handleAgentEvent(event, eventEnvelopeValue, () => state, (update) => {
    Object.assign(state, typeof update === "function" ? update(state) : update);
  });
}

function snapshot(sessionId: string) {
  return {
    sessionId,
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
