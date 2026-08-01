import type { ApprovalRequestView, ExtensionUiRequestView, OperationView, SessionSnapshot } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { useApprovalStore } from "../approval/approval-store.js";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { reduceInteractiveEvent } from "./interactive-event-reducer.js";

const operation: OperationView = {
  operationId: "operation-1",
  kind: "prompt",
  lifecycle: "waiting-input",
  cancellable: true,
  sessionId: "session-1",
  sessionGeneration: 3,
  startedAt: 1
};

const approval: ApprovalRequestView = {
  requestId: "approval-1",
  toolCallId: "tool-1",
  toolName: "bash",
  toolSource: "Pi 内置",
  category: "ambiguous-command",
  reason: "需要确认",
  targetKind: "command",
  target: "pnpm test",
  targetTruncated: false,
  cwd: "/workspace",
  cwdTruncated: false,
  scope: "single-tool-call",
  hostEpoch: 9,
  sessionId: "session-1",
  sessionGeneration: 3,
  operationId: "operation-1"
};

const extension: ExtensionUiRequestView = {
  requestId: "extension-1",
  kind: "confirm",
  blocking: true,
  hostEpoch: 9,
  sessionId: "session-1",
  sessionGeneration: 3,
  operationId: "operation-1"
};

describe("interactive request timeout events", () => {
  beforeEach(() => {
    useApprovalStore.setState(useApprovalStore.getInitialState(), true);
    useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    installSessionProjectionFixture(state(), snapshot(), 3);
  });

  it("makes authoritative Approval and Extension request timeouts observable", () => {
    const current = state();
    reduceInteractiveEvent({ type: "approval.requested", payload: approval }, envelope("approval.requested", approval), () => current);
    reduceInteractiveEvent({ type: "extension.ui.requested", payload: extension }, envelope("extension.ui.requested", extension), () => current);

    const approvalTimeout = {
      requests: [{ requestId: "approval-1", toolCallId: "tool-1" }],
      reason: "timeout" as const
    };
    reduceInteractiveEvent(
      { type: "approval.cancelled", payload: approvalTimeout },
      envelope("approval.cancelled", approvalTimeout),
      () => current
    );
    const extensionTimeout = { requestIds: ["extension-1"], reason: "timeout" as const };
    reduceInteractiveEvent(
      { type: "extension.ui.cancelled", payload: extensionTimeout },
      envelope("extension.ui.cancelled", extensionTimeout),
      () => current
    );

    expect(useApprovalStore.getState().requests).toEqual([]);
    expect(useExtensionUiStore.getState().requests).toEqual([]);
    expect(useNotificationStore.getState().items).toEqual([
      expect.objectContaining({
        level: "warning",
        title: "工具授权请求已超时",
        message: "未收到有效响应，工具保持阻止。"
      }),
      expect.objectContaining({
        level: "warning",
        title: "Extension 输入请求已超时",
        message: "未收到有效响应，Extension 已取消该请求。"
      })
    ]);
  });
});

function state() {
  return {
    connected: true,
    hostEpoch: 9,
    runtime: { phase: "busy" as const, detail: "运行中", recoverable: true },
    operation,
    operationDetail: undefined,
    operationProgress: undefined,
    sessionTransitionPending: false
  };
}

function envelope(type: Parameters<typeof eventEnvelope>[0], payload: unknown) {
  return eventEnvelope(type, payload as never, taskEventFixture({
    hostEpoch: 9,
    sequence: 1,
    sessionId: "session-1",
    sessionGeneration: 3,
    operationId: "operation-1"
  }));
}

function snapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
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
