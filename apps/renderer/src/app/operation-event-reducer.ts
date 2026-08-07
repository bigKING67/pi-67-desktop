import type {
  ApprovalRequestView,
  ExtensionUiRequestView,
  OperationActivity,
  OperationLifecycle
} from "@pi67/domain";
import type { AgentEvent, EventEnvelope, OperationSettled } from "@pi67/protocol";
import { useApprovalStore } from "../approval/approval-store.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import {
  recordOperationTerminal
} from "../notifications/notification-store.js";
import { useOperationActivityTimelineStore } from "../operation/operation-activity-timeline-store.js";
import { isActiveOperationLifecycle } from "../operation/operation-lifecycle.js";
import type { RendererSessionAuthority } from "../session/session-authority.js";
import { eventSessionAuthority } from "../connection/event-authority.js";
import type { AppEventState, EventStoreGet, EventStoreSet } from "./app-event-state.js";

export function reduceOperationEvent<TState extends AppEventState>(
  event: AgentEvent,
  envelope: EventEnvelope,
  get: EventStoreGet<TState>,
  set: EventStoreSet<TState>,
  sessionAuthority: RendererSessionAuthority | undefined
): boolean {
  switch (event.type) {
    case "turn.streamBatch":
      applyStreamBatch(event.payload.events, envelope);
      return true;
    case "operation.started":
      useLiveTurnStore.getState().begin(event.payload.operation, envelope.hostEpoch);
      useOperationActivityTimelineStore.getState().begin(event.payload.operation);
      set({
        operation: event.payload.operation,
        operationDetail: undefined,
        operationProgress: undefined,
        runtime: { phase: "busy", detail: "Pi 正在执行任务", recoverable: true }
      } as Partial<TState>);
      return true;
    case "operation.heartbeat":
      return acceptsLiveOperationEvent(get(), event.payload.operationId);
    case "operation.activityChanged":
      if (!acceptsLiveOperationEvent(get(), event.payload.operationId)) return false;
      useOperationActivityTimelineStore.getState().recordActivity(
        event.payload.operationId,
        event.payload.activity
      );
      updateOperation(set, event.payload.operationId, event.payload.activity);
      return true;
    case "operation.progress":
      if (!acceptsLiveOperationEvent(get(), event.payload.operationId)) return false;
      useOperationActivityTimelineStore.getState().updateProgress(
        event.payload.operationId,
        formatProgress(event.payload)
      );
      set((state) => state.operation?.operationId === event.payload.operationId
        ? { operationProgress: formatProgress(event.payload) } as Partial<TState>
        : {} as Partial<TState>);
      return true;
    case "operation.completed":
      if (!sessionAuthority || !acceptOperationTerminal(get(), event.payload.operationId, sessionAuthority)) return false;
      clearOperationInteractiveRequests(sessionAuthority, event.payload.operationId);
      useOperationActivityTimelineStore.getState().finish(
        event.payload.operationId,
        "completed",
        undefined,
        event.payload.completedAt
      );
      recordRealtimeOperationTerminal(get(), envelope, {
        operationId: event.payload.operationId,
        lifecycle: "completed",
        settledAt: event.payload.completedAt
      });
      finishOperation(set, event.payload.operationId, "completed", "任务已完成", sessionAuthority);
      return true;
    case "operation.failed":
      if (!sessionAuthority || !acceptOperationTerminal(get(), event.payload.operationId, sessionAuthority)) return false;
      clearOperationInteractiveRequests(sessionAuthority, event.payload.operationId);
      useOperationActivityTimelineStore.getState().finish(
        event.payload.operationId,
        "failed",
        event.payload.error.message,
        event.payload.failedAt
      );
      recordRealtimeOperationTerminal(get(), envelope, {
        operationId: event.payload.operationId,
        lifecycle: "failed",
        settledAt: event.payload.failedAt,
        error: event.payload.error
      });
      finishOperation(set, event.payload.operationId, "failed", event.payload.error.message, sessionAuthority);
      return true;
    case "operation.cancelled":
      if (!sessionAuthority || !acceptOperationTerminal(get(), event.payload.operationId, sessionAuthority)) return false;
      clearOperationInteractiveRequests(sessionAuthority, event.payload.operationId);
      useOperationActivityTimelineStore.getState().finish(
        event.payload.operationId,
        "cancelled",
        event.payload.reason,
        event.payload.cancelledAt
      );
      recordRealtimeOperationTerminal(get(), envelope, {
        operationId: event.payload.operationId,
        lifecycle: "cancelled",
        settledAt: event.payload.cancelledAt,
        reason: event.payload.reason
      });
      finishOperation(set, event.payload.operationId, "cancelled", event.payload.reason, sessionAuthority);
      return true;
    case "operation.lost":
      if (!sessionAuthority || !acceptOperationTerminal(get(), event.payload.operationId, sessionAuthority)) return false;
      clearOperationInteractiveRequests(sessionAuthority, event.payload.operationId);
      useOperationActivityTimelineStore.getState().finish(
        event.payload.operationId,
        "lost",
        event.payload.reason,
        event.payload.lostAt
      );
      recordRealtimeOperationTerminal(get(), envelope, {
        operationId: event.payload.operationId,
        lifecycle: "lost",
        settledAt: event.payload.lostAt,
        reason: event.payload.reason
      });
      finishOperation(set, event.payload.operationId, "lost", event.payload.reason, sessionAuthority);
      return true;
    default:
      return false;
  }
}

function clearOperationInteractiveRequests(
  authority: RendererSessionAuthority,
  operationId: string
): void {
  const approvalIds = useApprovalStore.getState().requests
    .filter((request) => matchesOperationInteractiveAuthority(request, authority, operationId))
    .map((request) => request.requestId);
  useApprovalStore.getState().removeRequests(approvalIds);

  const extensionIds = useExtensionUiStore.getState().requests
    .filter((request) => matchesOperationInteractiveAuthority(request, authority, operationId))
    .map((request) => request.requestId);
  useExtensionUiStore.getState().cancelRequests(extensionIds);
}

function matchesOperationInteractiveAuthority(
  request: ApprovalRequestView | ExtensionUiRequestView,
  authority: RendererSessionAuthority,
  operationId: string
): boolean {
  return request.hostEpoch === authority.hostEpoch
    && request.sessionId === authority.sessionId
    && request.sessionGeneration === authority.sessionGeneration
    && request.operationId === operationId;
}

function updateOperation<TState extends AppEventState>(
  set: EventStoreSet<TState>,
  operationId: string,
  activity: OperationActivity | null
): void {
  set((state) => {
    if (state.operation?.operationId !== operationId) return {} as Partial<TState>;
    if (activity === null) {
      const { activity: _activity, ...operation } = state.operation;
      return { operation: { ...operation, lifecycle: "running" } } as Partial<TState>;
    }
    return {
      operation: { ...state.operation, lifecycle: activityLifecycle(activity), activity }
    } as Partial<TState>;
  });
}

function finishOperation<TState extends AppEventState>(
  set: EventStoreSet<TState>,
  operationId: string,
  lifecycle: OperationLifecycle,
  detail: string,
  authority: RendererSessionAuthority
): void {
  useLiveTurnStore.getState().finish(operationId, lifecycle);
  if (lifecycle !== "completed") {
    useConversationStore.getState().markPendingUserTurnFailed(operationId, detail);
  }
  useConversationStore.getState().setStreaming(false, authority);
  set((state) => state.operation?.operationId === operationId ? {
    operation: {
      ...state.operation,
      lifecycle,
      ...(state.operation.kind === "session-import"
        ? {
            sessionId: authority.sessionId,
            sessionFileIdentity: authority.sessionFileIdentity,
            sessionGeneration: authority.sessionGeneration
          }
        : {})
    },
    operationDetail: detail,
    operationProgress: undefined,
    runtime: {
      phase: lifecycle === "failed" ? "failed" : lifecycle === "lost" ? "recovering" : "ready",
      detail,
      recoverable: true
    },
    sessionTransitionPending: state.operation.kind === "session-import" ? false : state.sessionTransitionPending
  } as Partial<TState> : {} as Partial<TState>);
}

function acceptOperationTerminal(
  state: AppEventState,
  operationId: string,
  authority: RendererSessionAuthority
): boolean {
  const operation = state.operation;
    return operation?.operationId === operationId
    && operation.sessionId === authority.sessionId
    && operation.sessionFileIdentity === authority.sessionFileIdentity
    && operation.sessionGeneration === authority.sessionGeneration;
}

function acceptsLiveOperationEvent(state: AppEventState, operationId: string): boolean {
  return state.operation?.operationId === operationId
    && isActiveOperationLifecycle(state.operation.lifecycle);
}

function activityLifecycle(activity: OperationActivity): OperationLifecycle {
  return activity.kind === "approval" || activity.kind === "extension-input" ? "waiting-input" : "running";
}

function formatProgress(progress: { message: string; current?: number; total?: number }): string {
  return progress.current === undefined || progress.total === undefined
    ? progress.message
    : `${progress.message} · ${progress.current}/${progress.total}`;
}

function applyStreamBatch(events: unknown[], envelope: EventEnvelope): void {
  let text = "";
  let thinking = "";
  for (const value of events) {
    if (typeof value !== "object" || value === null) continue;
    const assistant = (value as { assistantMessageEvent?: { type?: unknown; delta?: unknown } }).assistantMessageEvent;
    if (assistant?.type === "text_delta" && typeof assistant.delta === "string") text += assistant.delta;
    if (assistant?.type === "thinking_delta" && typeof assistant.delta === "string") thinking += assistant.delta;
  }
  if (!text && !thinking) return;
  const authority = eventSessionAuthority(envelope);
  useLiveTurnStore.getState().append({ text, thinking }, {
    hostEpoch: envelope.hostEpoch,
    ...(authority === undefined
      ? {}
      : {
          sessionId: authority.sessionId,
          sessionGeneration: authority.sessionGeneration,
          ...(authority.operationId === undefined ? {} : { operationId: authority.operationId })
        })
  });
}

type RealtimeTerminalInput =
  | { operationId: string; lifecycle: "completed"; settledAt: number }
  | {
      operationId: string;
      lifecycle: "failed";
      settledAt: number;
      error: Extract<OperationSettled, { lifecycle: "failed" }>["error"];
    }
  | { operationId: string; lifecycle: "cancelled" | "lost"; settledAt: number; reason: string };

function recordRealtimeOperationTerminal(
  state: AppEventState,
  envelope: EventEnvelope,
  input: RealtimeTerminalInput
): void {
  const operation = state.operation;
  const authority = eventSessionAuthority(envelope);
  if (
    !operation
    || operation.operationId !== input.operationId
    || state.hostEpoch !== envelope.hostEpoch
    || authority === undefined
    || (authority.operationId !== undefined && authority.operationId !== input.operationId)
  ) return;

  const base = {
    kind: "settled" as const,
    operationId: operation.operationId,
    operationKind: operation.kind,
    cancellable: false as const,
    hostEpoch: envelope.hostEpoch,
    sessionId: authority.sessionId,
    sessionFileIdentity: authority.sessionFileIdentity,
    sessionGeneration: authority.sessionGeneration,
    startedAt: operation.startedAt,
    settledAt: input.settledAt
  };
  if (input.lifecycle === "failed") {
    recordOperationTerminal({ ...base, lifecycle: input.lifecycle, error: input.error });
    return;
  }
  if (input.lifecycle === "cancelled" || input.lifecycle === "lost") {
    recordOperationTerminal({ ...base, lifecycle: input.lifecycle, reason: input.reason });
    return;
  }
  recordOperationTerminal({ ...base, lifecycle: input.lifecycle });
}
