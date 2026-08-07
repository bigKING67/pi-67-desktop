import type { ApprovalRequestView, OperationView, SessionSnapshot } from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { approvalResponsePayload, respondToSafetyApproval } from "./approval-response.js";
import { useApprovalStore } from "./approval-store.js";

const requestAgent = vi.hoisted(() => vi.fn());
const recoverTimeout = vi.hoisted(() => vi.fn());

vi.mock("../connection/AgentConnectionController.js", () => ({
  agentConnectionController: { request: requestAgent }
}));
vi.mock("../connection/interactive-response-timeout-recovery.js", () => ({
  recoverInteractiveResponseTimeout: recoverTimeout
}));

const operation: OperationView = {
  operationId: "operation-1",
  kind: "prompt",
  lifecycle: "waiting-input",
  cancellable: true,
  sessionId: "session-1",
  sessionFileIdentity: "session-file-session-1",
  sessionGeneration: 3,
  startedAt: 1
};

const request: ApprovalRequestView = {
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

const state = {
  connected: true,
  hostEpoch: 9,
  operation
};

beforeEach(() => installSession(3));

describe("approvalResponsePayload", () => {
  it("binds a response to the exact host, session, operation and tool call", () => {
    expect(approvalResponsePayload(state, request, "allow-once")).toEqual({
      requestId: "approval-1",
      toolCallId: "tool-1",
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1",
      decision: "allow-once"
    });
  });

  it("rejects stale authority context instead of guessing from current UI state", () => {
    const { operationId: _operationId, ...requestWithoutOperation } = request;
    expect(approvalResponsePayload({ ...state, hostEpoch: 10 }, request, "allow-once")).toBeUndefined();
    installSession(4);
    expect(approvalResponsePayload(state, request, "allow-once")).toBeUndefined();
    installSession(3);
    expect(approvalResponsePayload({ ...state, operation: { ...operation, operationId: "operation-2" } }, request, "allow-once")).toBeUndefined();
    expect(approvalResponsePayload(state, requestWithoutOperation, "allow-once")).toBeUndefined();
  });
});

function installSession(sessionGeneration: number): void {
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  installSessionProjectionFixture(
    state,
    snapshot(),
    sessionGeneration
  );
}

function snapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    sessionFileIdentity: "session-file-session-1",
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

describe("respondToSafetyApproval", () => {
  beforeEach(() => {
    requestAgent.mockReset();
    recoverTimeout.mockReset().mockResolvedValue(false);
    useApprovalStore.setState(useApprovalStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useApprovalStore.getState().upsertRequest(request);
  });

  it("removes an approval only after the authoritative Host accepts its response", async () => {
    requestAgent.mockResolvedValue({ resolved: true });

    await expect(respondToSafetyApproval(() => state, request.requestId, "deny")).resolves.toBe(true);

    expect(requestAgent).toHaveBeenCalledWith("approval.respond", {
      requestId: "approval-1",
      toolCallId: "tool-1",
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1",
      decision: "deny"
    });
    expect(useApprovalStore.getState().requests).toEqual([]);
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("reports a fail-closed result instead of silently treating resolved false as success", async () => {
    requestAgent.mockResolvedValue({ resolved: false });

    await expect(respondToSafetyApproval(() => state, request.requestId, "allow-once")).resolves.toBe(false);

    expect(useApprovalStore.getState().requests).toEqual([]);
    expect(useNotificationStore.getState().items).toEqual([
      expect.objectContaining({
        level: "warning",
        title: "工具授权请求已过期",
        message: "Pi 运行服务未接受这次授权响应，工具将保持阻止状态。"
      })
    ]);
  });

  it("keeps the approval visible when transport submission fails", async () => {
    requestAgent.mockRejectedValue(new Error("connection closed"));

    await expect(respondToSafetyApproval(() => state, request.requestId, "allow-once")).resolves.toBe(false);

    expect(useApprovalStore.getState().requests).toEqual([request]);
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法提交工具授权",
      message: "connection closed。授权请求仍保留，可以重试。"
    });
  });

  it("enters authoritative recovery instead of inviting a blind retry after an acknowledgement timeout", async () => {
    const error = requestTimeout("approval.respond");
    requestAgent.mockRejectedValue(error);
    recoverTimeout.mockResolvedValue(true);

    await expect(respondToSafetyApproval(() => state, request.requestId, "allow-once")).resolves.toBe(false);

    expect(recoverTimeout).toHaveBeenCalledWith(error, {
      kind: "approval",
      hostEpoch: 9,
      operationId: "operation-1"
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("removes a stale request without sending an approval decision", async () => {
    await expect(respondToSafetyApproval(
      () => ({ ...state, hostEpoch: 10 }),
      request.requestId,
      "allow-once"
    )).resolves.toBe(false);

    expect(requestAgent).not.toHaveBeenCalled();
    expect(useApprovalStore.getState().requests).toEqual([]);
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "工具授权请求已过期"
    });
  });

  it("does not remove a same-id request installed while the previous response is in flight", async () => {
    let resolveResponse!: (value: { resolved: boolean }) => void;
    requestAgent.mockReturnValue(new Promise((resolve) => {
      resolveResponse = resolve;
    }));

    const pending = respondToSafetyApproval(() => state, request.requestId, "deny");
    await vi.waitFor(() => expect(requestAgent).toHaveBeenCalledOnce());
    const replacement = { ...request, reason: "新 Host 的授权请求" };
    useApprovalStore.getState().reset();
    useApprovalStore.getState().upsertRequest(replacement);
    resolveResponse({ resolved: true });

    await expect(pending).resolves.toBe(true);
    expect(useApprovalStore.getState().requests).toEqual([replacement]);
  });
});

function requestTimeout(type: string): ProtocolRequestError {
  return new ProtocolRequestError({
    code: "REQUEST_TIMEOUT",
    message: `Agent request acknowledgement timed out: ${type}`,
    recoverable: true
  });
}
