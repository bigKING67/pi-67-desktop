import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import {
  eventSessionAuthority,
  eventTaskAuthority
} from "../connection/event-authority.js";
import { messages } from "../localization/message-catalog.js";
import { markConversationAttention } from "../navigation/conversation-attention-store.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  taskForConversation
} from "./workbench-store.js";

export type WorkbenchEventRoute = "active" | "background" | "stale" | "unscoped";

export function classifyWorkbenchAgentEvent(
  event: AgentEvent,
  envelope: EventEnvelope
): WorkbenchEventRoute {
  const authority = eventTaskAuthority(envelope);
  if (!authority) return "unscoped";
  const workbench = rendererWorkbenchStore.getState();
  const task = workbench.tasks[authority.taskId];
  if (!task) return "stale";
  if (
    task.workspaceId !== authority.workspaceId
    || task.taskGeneration !== authority.taskGeneration
  ) return "stale";

  const operationId = operationIdForEvent(event);
  if (
    operationId
    && event.type !== "operation.started"
    && task.operationId !== operationId
  ) return "stale";
  if (
    operationId
    && isLiveOperationEvent(event.type)
    && task.operationId === operationId
    && isTerminalTaskLifecycle(task.lifecycle)
  ) return "stale";

  const sessionAuthority = eventSessionAuthority(envelope);
  if (
    event.type !== "runtime.ready"
    && event.type !== "session.bootstrap"
    && eventUpdatesWorkbenchTaskSummary(event.type)
    && sessionAuthority
    && (
      task.sessionId !== sessionAuthority.sessionId
      || task.sessionFileIdentity !== sessionAuthority.sessionFileIdentity
      || task.sessionGeneration !== sessionAuthority.sessionGeneration
    )
  ) return "stale";

  if (
    event.type === "session.bootstrap"
    && event.payload.reason === "session-import"
    && (
      sessionAuthority?.operationId === undefined
      || task.operationId !== sessionAuthority.operationId
      || isTerminalTaskLifecycle(task.lifecycle)
    )
  ) return "stale";

  if (
    event.type === "runtime.ready"
    && task.conversation.kind === "provisional"
    && task.creationId
  ) return "stale";

  const activeTask = selectedWorkbenchTask(workbench) ?? (
    workbench.selectedSurface?.kind === "settings"
    && workbench.settingsReturnSurface?.kind === "conversation"
      ? taskForConversation(workbench.tasks, workbench.settingsReturnSurface.conversation)
      : undefined
  );
  return activeTask?.id === task.id
    ? "active"
    : "background";
}

export function applyWorkbenchAgentEvent(
  event: AgentEvent,
  envelope: EventEnvelope
): boolean {
  const route = classifyWorkbenchAgentEvent(event, envelope);
  if (route === "stale" || route === "unscoped") return false;
  const authority = eventTaskAuthority(envelope);
  if (!authority) return false;
  const workbench = rendererWorkbenchStore.getState();
  const task = workbench.tasks[authority.taskId];
  if (!task) return false;

  switch (event.type) {
    case "runtime.ready":
    case "session.bootstrap": {
      const snapshot = event.payload.snapshot;
      const sessionName = snapshot.sessionName?.trim();
      const sessionAuthority = eventSessionAuthority(envelope);
      workbench.updateTask(task.id, {
        ...(snapshot.sessionPath === undefined || snapshot.sessionFileIdentity === undefined
          ? {}
          : {
              conversation: {
                kind: "session" as const,
                workspaceId: task.workspaceId,
                sessionFileIdentity: snapshot.sessionFileIdentity,
                sessionPath: snapshot.sessionPath
              },
              sessionFileIdentity: snapshot.sessionFileIdentity,
              sessionPath: snapshot.sessionPath
            }),
        sessionId: snapshot.sessionId,
        ...(sessionAuthority === undefined
          ? {}
          : { sessionGeneration: sessionAuthority.sessionGeneration }),
        title: sessionName
          || task.pendingTitle
          || messages.runtime.workbench.unnamedSession,
        titleSource: sessionName ? "explicit" : task.pendingTitle ? "latest-user" : "fallback",
        ...(sessionName ? { pendingTitle: undefined } : {}),
        lifecycle: "idle",
        runtime: { phase: "ready", detail: messages.runtime.workbench.sessionReady, recoverable: true },
        ...(event.type === "runtime.ready" ? { toolMode: event.payload.taskToolMode } : {}),
        operationId: undefined,
        creationId: undefined,
        creationStatus: undefined,
      });
      break;
    }
    case "task.toolMode.changed":
      workbench.updateTask(task.id, { toolMode: event.payload.mode });
      break;
    case "runtime.statusChanged":
      workbench.updateTask(task.id, { runtime: event.payload });
      break;
    case "runtime.crashed":
      workbench.updateTask(task.id, {
        lifecycle: "lost",
        runtime: { phase: "failed", detail: event.payload.detail, recoverable: event.payload.recoverable }
      });
      break;
    case "operation.started":
      workbench.updateTask(task.id, {
        lifecycle: "running",
        runtime: { phase: "busy", detail: messages.operation.running, recoverable: true },
        operationId: event.payload.operation.operationId
      });
      break;
    case "operation.activityChanged":
      workbench.updateTask(task.id, {
        lifecycle: event.payload.activity?.kind === "approval"
          ? "waiting-approval"
          : event.payload.activity?.kind === "extension-input"
            ? "waiting-extension-input"
            : "running"
      });
      break;
    case "operation.completed":
      workbench.updateTask(task.id, { lifecycle: "completed", runtime: { phase: "ready", detail: messages.operation.completed, recoverable: true }, operationId: event.payload.operationId });
      break;
    case "operation.failed":
      workbench.updateTask(task.id, { lifecycle: "failed", runtime: { phase: "failed", detail: event.payload.error.message, recoverable: event.payload.error.recoverable }, operationId: event.payload.operationId });
      break;
    case "operation.cancelled":
      workbench.updateTask(task.id, { lifecycle: "cancelled", runtime: { phase: "ready", detail: event.payload.reason, recoverable: true }, operationId: event.payload.operationId });
      break;
    case "operation.lost":
      workbench.updateTask(task.id, { lifecycle: "lost", runtime: { phase: "failed", detail: event.payload.reason, recoverable: true }, operationId: event.payload.operationId });
      break;
    case "session.metaChanged":
      workbench.updateTask(task.id, {
        title: event.payload.sessionName?.trim() || messages.runtime.workbench.unnamedSession,
        titleSource: event.payload.sessionName?.trim() ? "explicit" : "fallback",
        ...(event.payload.sessionName?.trim() ? { pendingTitle: undefined } : {})
      });
      break;
    default:
      break;
  }
  if (
    route === "background"
    && eventRequiresConversationAttention(event)
    && task.conversation.kind === "session"
    && eventSessionAuthority(envelope)?.sessionFileIdentity === task.conversation.sessionFileIdentity
  ) {
    markConversationAttention(task.workspaceId, task.conversation.sessionFileIdentity);
  }
  return true;
}

function eventRequiresConversationAttention(event: AgentEvent): boolean {
  switch (event.type) {
    case "runtime.crashed":
    case "operation.completed":
    case "operation.failed":
    case "operation.lost":
      return true;
    case "operation.activityChanged":
      return event.payload.activity?.kind === "approval"
        || event.payload.activity?.kind === "extension-input";
    default:
      return false;
  }
}

function operationIdForEvent(event: AgentEvent): string | undefined {
  switch (event.type) {
    case "operation.started":
      return event.payload.operation.operationId;
    case "operation.heartbeat":
    case "operation.activityChanged":
    case "operation.progress":
    case "operation.completed":
    case "operation.failed":
    case "operation.cancelled":
    case "operation.lost":
      return event.payload.operationId;
    default:
      return undefined;
  }
}

function isTerminalTaskLifecycle(lifecycle: string): boolean {
  return lifecycle === "completed"
    || lifecycle === "failed"
    || lifecycle === "cancelled"
    || lifecycle === "lost";
}

function isLiveOperationEvent(type: AgentEvent["type"]): boolean {
  return type === "operation.started"
    || type === "operation.heartbeat"
    || type === "operation.activityChanged"
    || type === "operation.progress";
}

function eventUpdatesWorkbenchTaskSummary(type: AgentEvent["type"]): boolean {
  switch (type) {
    case "task.toolMode.changed":
    case "runtime.statusChanged":
    case "runtime.crashed":
    case "operation.started":
    case "operation.activityChanged":
    case "operation.completed":
    case "operation.failed":
    case "operation.cancelled":
    case "operation.lost":
    case "session.metaChanged":
      return true;
    default:
      return false;
  }
}
