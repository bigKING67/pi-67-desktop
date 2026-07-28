import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import { eventTaskAuthority } from "../connection/event-authority.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  taskForConversation
} from "./workbench-store.js";

export type WorkbenchEventRoute = "active" | "background" | "stale" | "unscoped";

export function routeWorkbenchAgentEvent(
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

  const sessionContext = envelope.context.scope === "task" && envelope.context.sessionId !== undefined
    ? envelope.context
    : undefined;
  switch (event.type) {
    case "runtime.ready":
    case "session.bootstrap": {
      const snapshot = event.type === "runtime.ready" ? event.payload.snapshot : event.payload.snapshot;
      workbench.updateTask(task.id, {
        ...(snapshot.sessionPath ? {
          conversation: { kind: "session" as const, workspaceId: task.workspaceId, sessionPath: snapshot.sessionPath }
        } : {}),
        sessionId: snapshot.sessionId,
        ...(sessionContext ? { sessionGeneration: sessionContext.sessionGeneration } : {}),
        ...(snapshot.sessionPath ? { sessionPath: snapshot.sessionPath } : {}),
        title: snapshot.sessionName?.trim() || "未命名会话",
        lifecycle: "idle",
        runtime: { phase: "ready", detail: "Pi 会话已就绪", recoverable: true }
      });
      break;
    }
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
      workbench.updateTask(task.id, { lifecycle: "running", runtime: { phase: "busy", detail: "Pi 正在执行任务", recoverable: true } });
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
      workbench.updateTask(task.id, { lifecycle: "completed", runtime: { phase: "ready", detail: "任务已完成", recoverable: true } });
      break;
    case "operation.failed":
      workbench.updateTask(task.id, { lifecycle: "failed", runtime: { phase: "failed", detail: event.payload.error.message, recoverable: event.payload.error.recoverable } });
      break;
    case "operation.cancelled":
      workbench.updateTask(task.id, { lifecycle: "cancelled", runtime: { phase: "ready", detail: event.payload.reason, recoverable: true } });
      break;
    case "operation.lost":
      workbench.updateTask(task.id, { lifecycle: "lost", runtime: { phase: "failed", detail: event.payload.reason, recoverable: true } });
      break;
    case "session.metaChanged":
      workbench.updateTask(task.id, { title: event.payload.sessionName?.trim() || "未命名会话" });
      break;
    default:
      break;
  }

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
