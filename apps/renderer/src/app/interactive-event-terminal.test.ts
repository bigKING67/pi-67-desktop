import type { ApprovalRequestView, ExtensionUiRequestView } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { useApprovalStore } from "../approval/approval-store.js";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import {
  installSessionProjectionFixture,
  sessionSnapshotFixture
} from "../session/session-projection-test-support.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { reduceInteractiveEvent } from "./interactive-event-reducer.js";

const approval: ApprovalRequestView = {
  requestId: "approval-1",
  toolCallId: "tool-1",
  toolName: "get_search_content",
  toolSource: "Pi 内置",
  category: "ambiguous-command",
  reason: "需要确认",
  targetKind: "tool",
  target: "get_search_content",
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
  title: "继续？",
  blocking: true,
  hostEpoch: 9,
  sessionId: "session-1",
  sessionGeneration: 3,
  operationId: "operation-1"
};

describe("interactive terminal event cleanup", () => {
  beforeEach(() => {
    useApprovalStore.setState(useApprovalStore.getInitialState(), true);
    useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    installSessionProjectionFixture(
      { connected: true, hostEpoch: 9 },
      sessionSnapshotFixture(),
      3
    );
  });

  it("clears exact Approval and Extension requests after their Operation has settled", () => {
    useApprovalStore.getState().upsertRequest(approval);
    useExtensionUiStore.getState().upsertRequest(extension);
    const state = {
      connected: true,
      hostEpoch: 9,
      operation: undefined,
      runtime: { phase: "ready" as const, detail: "ready", recoverable: true },
      operationDetail: undefined,
      operationProgress: undefined,
      sessionTransitionPending: false
    };
    const approvalPayload = {
      requests: [{ requestId: "approval-1", toolCallId: "tool-1" }],
      reason: "timeout" as const
    };
    const extensionPayload = { requestIds: ["extension-1"], reason: "timeout" as const };

    reduceInteractiveEvent(
      { type: "approval.cancelled", payload: approvalPayload },
      eventEnvelope("approval.cancelled", approvalPayload, context()),
      () => state
    );
    reduceInteractiveEvent(
      { type: "extension.ui.cancelled", payload: extensionPayload },
      eventEnvelope("extension.ui.cancelled", extensionPayload, context(2)),
      () => state
    );

    expect(useApprovalStore.getState().requests).toEqual([]);
    expect(useExtensionUiStore.getState().requests).toEqual([]);
  });
});

function context(sequence = 1) {
  return taskEventFixture({
    hostEpoch: 9,
    sequence,
    sessionId: "session-1",
    sessionGeneration: 3,
    operationId: "operation-1"
  });
}
