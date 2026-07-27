import type {
  ApprovalRequestView,
  ExtensionUiRequestView,
  OperationView,
  SessionSnapshot
} from "@pi67/domain";
import { eventEnvelope as createEventEnvelope, type EventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { useApprovalStore } from "../approval/approval-store.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
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

const approval: ApprovalRequestView = {
  requestId: "approval-1",
  toolCallId: "tool-1",
  toolName: "bash",
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
  title: "继续？",
  blocking: true,
  hostEpoch: 9,
  sessionId: "session-1",
  sessionGeneration: 3,
  operationId: "operation-1"
};

describe("handleAgentEvent interactive authority", () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
    useApprovalStore.setState(useApprovalStore.getInitialState(), true);
    useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
    useLiveTurnStore.getState().reset();
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    installSessionProjectionFixture(
      { connected: true, hostEpoch: 9 },
      sessionSnapshot(),
      3
    );
  });

  it("accepts a current approval and rejects stale host, session, generation, or operation context", () => {
    const state = eventState();
    dispatch(state, { type: "approval.requested", payload: approval }, eventEnvelope("approval.requested"));
    expect(useApprovalStore.getState().requests).toEqual([approval]);
    expect(state.operation).toEqual(operation);

    for (const stale of [
      { ...approval, requestId: "stale-host", hostEpoch: 8 },
      { ...approval, requestId: "stale-session", sessionId: "session-old" },
      { ...approval, requestId: "stale-generation", sessionGeneration: 2 },
      { ...approval, requestId: "stale-operation", operationId: "operation-old" }
    ]) {
      const before = useApprovalStore.getState().requests.length;
      dispatch(state, { type: "approval.requested", payload: stale }, eventEnvelope("approval.requested"));
      expect(useApprovalStore.getState().requests).toHaveLength(before);
    }
  });

  it("keeps generic Extension confirmation separate from safety approval state", () => {
    const state = eventState();
    dispatch(state, { type: "approval.requested", payload: approval }, eventEnvelope("approval.requested"));
    dispatch(state, { type: "extension.ui.requested", payload: extension }, eventEnvelope("extension.ui.requested"));

    expect(useApprovalStore.getState().requests.map((request) => request.requestId)).toEqual(["approval-1"]);
    expect(useExtensionUiStore.getState().requests.map((request) => request.requestId)).toEqual(["extension-1"]);

    dispatch(state, { type: "extension.ui.cancelled", payload: { requestIds: ["extension-1"], reason: "connection-close" } },
      createEventEnvelope("extension.ui.cancelled", { requestIds: ["extension-1"], reason: "connection-close" }, {
        hostEpoch: 8, sequence: 2, sessionId: "session-1", sessionGeneration: 3, operationId: "operation-1"
      }));
    expect(useExtensionUiStore.getState().requests).toEqual([extension]);

    dispatch(state, {
      type: "extension.ui.cancelled",
      payload: { requestIds: ["extension-1"], reason: "connection-close" }
    }, eventEnvelope("extension.ui.cancelled"));
    expect(useExtensionUiStore.getState().requests).toEqual([]);
    expect(useApprovalStore.getState().requests.map((request) => request.requestId)).toEqual(["approval-1"]);

    dispatch(state, {
      type: "approval.cancelled",
      payload: { requests: [{ requestId: "approval-1", toolCallId: "tool-1" }], reason: "connection-close" }
    }, eventEnvelope("approval.cancelled"));
    expect(useApprovalStore.getState().requests).toEqual([]);
  });

  it("clears approvals only when terminal tool identity and interactive authority still match", () => {
    const state = eventState();
    dispatch(state, { type: "approval.requested", payload: approval }, eventEnvelope("approval.requested"));

    dispatch(state, {
      type: "approval.resolved",
      payload: { requestId: "approval-1", toolCallId: "tool-wrong", allowed: false }
    }, eventEnvelopeFor("approval.resolved", {
      requestId: "approval-1",
      toolCallId: "tool-wrong",
      allowed: false
    }));
    expect(useApprovalStore.getState().requests).toEqual([approval]);

    const staleEnvelope = createEventEnvelope("approval.cancelled", {
      requests: [{ requestId: "approval-1", toolCallId: "tool-1" }],
      reason: "connection-close"
    }, {
      hostEpoch: 8,
      sequence: 2,
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1"
    });
    dispatch(state, {
      type: "approval.cancelled",
      payload: staleEnvelope.payload
    }, staleEnvelope);
    expect(useApprovalStore.getState().requests).toEqual([approval]);

    dispatch(state, {
      type: "approval.resolved",
      payload: { requestId: "approval-1", toolCallId: "tool-1", allowed: false }
    }, eventEnvelopeFor("approval.resolved", {
      requestId: "approval-1",
      toolCallId: "tool-1",
      allowed: false
    }));
    expect(useApprovalStore.getState().requests).toEqual([]);
    expect(state.operation).toEqual(operation);
  });

  it("does not render a stale Extension request before the user can respond", () => {
    const state = eventState();
    dispatch(state, {
      type: "extension.ui.requested",
      payload: { ...extension, hostEpoch: 8 }
    }, eventEnvelope("extension.ui.requested"));
    expect(useExtensionUiStore.getState().requests).toEqual([]);
    expect(state.operation).toEqual(operation);
  });

  it("applies only authoritative Extension updates and removes cleared status/widget entries", () => {
    const state = eventState();
    const status = extensionUpdate({ kind: "status", key: "build", message: "running" });
    dispatch(state, { type: "extension.ui.updated", payload: status }, eventEnvelope("extension.ui.updated"));
    expect(Object.values(useExtensionUiStore.getState().statuses)).toEqual([expect.objectContaining({
      key: "build",
      message: "running",
      attribution: "unattributed"
    })]);

    dispatch(state, {
      type: "extension.ui.updated",
      payload: { ...extensionUpdate({ kind: "status", key: "build", message: "stale" }), hostEpoch: 8 }
    }, eventEnvelope("extension.ui.updated"));
    expect(Object.values(useExtensionUiStore.getState().statuses).map((item) => item.message)).toEqual(["running"]);

    dispatch(state, {
      type: "extension.ui.updated",
      payload: extensionUpdate({ kind: "status", key: "build" })
    }, eventEnvelope("extension.ui.updated"));
    expect(useExtensionUiStore.getState().statuses).toEqual({});

    dispatch(state, {
      type: "extension.ui.updated",
      payload: extensionUpdate({ kind: "widget", key: "summary", message: "ready", placement: "belowEditor" })
    }, eventEnvelope("extension.ui.updated"));
    expect(Object.values(useExtensionUiStore.getState().widgets)).toEqual([expect.objectContaining({
      key: "summary",
      message: "ready",
      placement: "belowEditor"
    })]);
    dispatch(state, {
      type: "extension.ui.updated",
      payload: extensionUpdate({ kind: "widget", key: "summary" })
    }, eventEnvelope("extension.ui.updated"));
    expect(useExtensionUiStore.getState().widgets).toEqual({});
  });

  it("keeps Extension title and compatibility structured and generation-scoped", () => {
    const state = eventState();
    dispatch(state, {
      type: "extension.ui.updated",
      payload: extensionUpdate({ kind: "title", message: "Build monitor" })
    }, eventEnvelope("extension.ui.updated"));
    expect(useExtensionUiStore.getState().title).toBe("Build monitor");

    const compatibility = {
      extensionPackage: "fixture-extension",
      status: "tui-only" as const,
      detail: "custom UI requires Pi TUI",
      hostEpoch: 9,
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1"
    };
    dispatch(state, {
      type: "extension.compatibilityChanged",
      payload: compatibility
    }, eventEnvelope("extension.compatibilityChanged"));
    expect(useExtensionUiStore.getState().compatibility["fixture-extension"]).toEqual({
      id: "fixture-extension",
      label: "fixture-extension",
      status: "tui-only",
      detail: "custom UI requires Pi TUI",
      attribution: "identified"
    });
    expect(useNotificationStore.getState().items).toEqual([
      expect.objectContaining({ title: "Extension 兼容性受限", message: "custom UI requires Pi TUI" })
    ]);

    dispatch(state, {
      type: "extension.compatibilityChanged",
      payload: { ...compatibility, detail: "stale", sessionGeneration: 2 }
    }, eventEnvelope("extension.compatibilityChanged"));
    expect(useExtensionUiStore.getState().compatibility["fixture-extension"]?.detail).toBe("custom UI requires Pi TUI");
  });

  it("shows only current path-free external Session conflicts with recovery-aware copy", () => {
    const state = eventState();
    dispatch(state, {
      type: "session.externalChangeDetected",
      payload: { reason: "invalid", recoverable: false }
    }, eventEnvelopeFor("session.externalChangeDetected", { reason: "invalid", recoverable: false }));
    expect(useNotificationStore.getState().items).toEqual([
      expect.objectContaining({
        title: "Pi 会话已在外部修改",
        message: "会话文件包含无效 JSONL，需要先修复或重新导入。"
      })
    ]);

    dispatch(state, {
      type: "session.externalChangeDetected",
      payload: { reason: "appended", recoverable: true }
    }, createEventEnvelope("session.externalChangeDetected", {
      reason: "appended",
      recoverable: true
    }, {
      hostEpoch: 9,
      sequence: 4,
      sessionId: "session-old",
      sessionGeneration: 2
    }));
    expect(useNotificationStore.getState().items).toHaveLength(1);
    expect(JSON.stringify(useNotificationStore.getState().items)).not.toMatch(/[A-Z]:\\|\/Users\//u);
  });

  it("routes stream batches through the operation-scoped Live Turn Store", () => {
    const state = eventState();
    dispatch(state, { type: "operation.started", payload: { operation } }, eventEnvelopeFor(
      "operation.started",
      { operation }
    ));
    dispatch(state, {
      type: "turn.streamBatch",
      payload: {
        events: [
          { assistantMessageEvent: { type: "thinking_delta", delta: "plan" } },
          { assistantMessageEvent: { type: "text_delta", delta: "result" } }
        ]
      }
    }, eventEnvelopeFor("turn.streamBatch", {
      events: [
        { assistantMessageEvent: { type: "thinking_delta", delta: "plan" } },
        { assistantMessageEvent: { type: "text_delta", delta: "result" } }
      ]
    }));

    expect(useLiveTurnStore.getState().thinkingChunks.join("")).toBe("plan");
    expect(useLiveTurnStore.getState().textChunks.join("")).toBe("result");
    dispatch(state, {
      type: "operation.failed",
      payload: {
        operationId: "operation-1",
        failedAt: 2,
        error: { code: "INTERNAL", message: "failed", recoverable: true }
      }
    }, eventEnvelopeFor("operation.failed", {
      operationId: "operation-1",
      failedAt: 2,
      error: { code: "INTERNAL", message: "failed", recoverable: true }
    }));
    expect(useLiveTurnStore.getState().textChunks).toEqual([]);
  });

  it("keeps the runtime recovering after an operation is lost", () => {
    const state = eventState();
    dispatch(state, {
      type: "operation.lost",
      payload: {
        operationId: "operation-1",
        lostAt: 2,
        reason: "Agent Host replacement is required."
      }
    }, eventEnvelopeFor("operation.lost", {
      operationId: "operation-1",
      lostAt: 2,
      reason: "Agent Host replacement is required."
    }));

    expect(state.operation?.lifecycle).toBe("lost");
    expect(state.runtime).toMatchObject({ phase: "recovering" });
    expect(useNotificationStore.getState().items).toEqual([
      expect.objectContaining({ level: "warning", title: "任务已中断" })
    ]);
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

function sessionSnapshot(): SessionSnapshot {
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

function eventEnvelopeFor<T extends EventEnvelope["type"]>(type: T, payload: unknown): EventEnvelope {
  return createEventEnvelope(type, payload as never, {
    hostEpoch: 9,
    sequence: 1,
    sessionId: "session-1",
    sessionGeneration: 3,
    operationId: "operation-1"
  });
}

function eventEnvelope(type: EventEnvelope["type"]): EventEnvelope {
  return createEventEnvelope(type, eventPayload(type), {
    hostEpoch: 9,
    sequence: 1,
    sessionId: "session-1",
    sessionGeneration: 3,
    operationId: "operation-1"
  });
}

function eventPayload(type: EventEnvelope["type"]): never {
  if (type === "approval.requested") return approval as never;
  if (type === "extension.ui.requested") return extension as never;
  if (type === "extension.ui.updated") return extensionUpdate({ kind: "status", key: "fixture", message: "ready" }) as never;
  if (type === "extension.compatibilityChanged") {
    return {
      status: "partial",
      detail: "fixture",
      hostEpoch: 9,
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1"
    } as never;
  }
  if (type === "extension.catalog.changed") {
    return { items: [], total: 0, truncated: false } as never;
  }
  if (type === "approval.cancelled") {
    return { requests: [], reason: "connection-close" } as never;
  }
  if (type === "extension.ui.cancelled") {
    return { requestIds: [], reason: "connection-close" } as never;
  }
  throw new Error(`Unsupported fixture event: ${type}`);
}

function extensionUpdate(
  update: Pick<ExtensionUiRequestView, "kind"> & Partial<ExtensionUiRequestView>
): ExtensionUiRequestView {
  return {
    requestId: `update-${update.kind}`,
    blocking: false,
    hostEpoch: 9,
    sessionId: "session-1",
    sessionGeneration: 3,
    operationId: "operation-1",
    ...update
  };
}

function dispatch<TState extends ReturnType<typeof eventState>>(
  state: TState,
  event: RoutedAgentEvent,
  envelope: EventEnvelope
): void {
  handleAgentEvent(event, envelope, () => state, (update) => {
    Object.assign(state, typeof update === "function" ? update(state) : update);
  });
}
