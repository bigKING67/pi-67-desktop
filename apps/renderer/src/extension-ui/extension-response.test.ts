import type { ExtensionUiRequestView, OperationView, SessionSnapshot } from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { respondToExtensionUi } from "./extension-response.js";
import { useExtensionUiStore } from "./extension-ui-store.js";

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

const request: ExtensionUiRequestView = {
  requestId: "extension-1",
  kind: "confirm",
  blocking: true,
  hostEpoch: 9,
  sessionId: "session-1",
  sessionGeneration: 3,
  operationId: "operation-1"
};

const authority = {
  connected: true,
  hostEpoch: 9,
  operation
};

describe("respondToExtensionUi", () => {
  beforeEach(() => {
    requestAgent.mockReset();
    recoverTimeout.mockReset().mockResolvedValue(false);
    useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    installSessionProjectionFixture(authority, snapshot(), 3);
    useExtensionUiStore.getState().upsertRequest(request);
  });

  it("removes a request only after the authoritative Host accepts its response", async () => {
    requestAgent.mockResolvedValue({ resolved: true });

    await expect(respondToExtensionUi(() => authority, request.requestId, true)).resolves.toBe(true);

    expect(requestAgent).toHaveBeenCalledWith("extension.ui.respond", {
      requestId: "extension-1",
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1",
      value: true
    });
    expect(useExtensionUiStore.getState().requests).toEqual([]);
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("does not send a response after interactive authority becomes stale", async () => {
    await expect(respondToExtensionUi(
      () => ({ ...authority, hostEpoch: 10 }),
      request.requestId,
      true
    )).resolves.toBe(false);

    expect(requestAgent).not.toHaveBeenCalled();
    expect(useExtensionUiStore.getState().requests).toEqual([]);
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "Extension 请求已过期"
    });
  });

  it("reports resolved false instead of silently treating it as success", async () => {
    requestAgent.mockResolvedValue({ resolved: false });

    await expect(respondToExtensionUi(() => authority, request.requestId, "answer"))
      .resolves.toBe(false);

    expect(useExtensionUiStore.getState().requests).toEqual([]);
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "Extension 请求已过期",
      message: "Pi 运行服务未接受这次响应；请求已不再有效，没有输入被执行。"
    });
  });

  it("keeps the request visible and contains transport rejection", async () => {
    requestAgent.mockRejectedValue(new Error("connection closed"));

    await expect(respondToExtensionUi(() => authority, request.requestId, true))
      .resolves.toBe(false);

    expect(useExtensionUiStore.getState().requests).toEqual([request]);
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法提交 Extension 响应",
      message: "connection closed。请求仍保留，可以重试。"
    });
  });

  it("enters authoritative recovery after an acknowledgement timeout", async () => {
    const error = new ProtocolRequestError({
      code: "REQUEST_TIMEOUT",
      message: "Agent request acknowledgement timed out: extension.ui.respond",
      recoverable: true
    });
    requestAgent.mockRejectedValue(error);
    recoverTimeout.mockResolvedValue(true);

    await expect(respondToExtensionUi(() => authority, request.requestId, true)).resolves.toBe(false);

    expect(recoverTimeout).toHaveBeenCalledWith(error, {
      kind: "extension",
      hostEpoch: 9,
      operationId: "operation-1"
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("preserves explicit cancellation in the Host payload", async () => {
    requestAgent.mockResolvedValue({ resolved: true });

    await respondToExtensionUi(() => authority, request.requestId, undefined, true);

    expect(requestAgent).toHaveBeenCalledWith("extension.ui.respond", {
      requestId: "extension-1",
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1",
      cancelled: true
    });
  });

  it("does not remove a same-id request installed while the previous response is in flight", async () => {
    let resolveResponse!: (value: { resolved: boolean }) => void;
    requestAgent.mockReturnValue(new Promise((resolve) => {
      resolveResponse = resolve;
    }));

    const pending = respondToExtensionUi(() => authority, request.requestId, true);
    await vi.waitFor(() => expect(requestAgent).toHaveBeenCalledOnce());
    const replacement = { ...request, title: "New Host request" };
    useExtensionUiStore.getState().resetInteractive();
    useExtensionUiStore.getState().upsertRequest(replacement);
    resolveResponse({ resolved: true });

    await expect(pending).resolves.toBe(true);
    expect(useExtensionUiStore.getState().requests).toEqual([replacement]);
  });
});

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
