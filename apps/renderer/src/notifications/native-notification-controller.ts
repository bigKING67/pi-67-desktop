import type {
  NativeNotificationActivation,
  NativeNotificationKind,
  NativeNotificationRequest
} from "@pi67/domain";
import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import { eventSessionAuthority } from "../connection/event-authority.js";
import {
  selectWorkspaceSessionCatalog,
  useSessionCatalogStore
} from "../navigation/session-catalog-store.js";
import { activateRendererTask } from "../workbench/task-activation-controller.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask
} from "../workbench/workbench-store.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import type { WorkbenchEventRoute } from "../workbench/workbench-event-router.js";
import { publishNotification } from "./notification-store.js";

const MAX_TRACKED_NATIVE_NOTIFICATIONS = 512;

const trackedNotifications = new Map<string, NativeNotificationRequest>();
const trackedNotificationOrder: string[] = [];
let controllerDisposer: (() => void) | undefined;

export function initializeNativeNotificationController(
  workbenchReady: PromiseLike<void> = Promise.resolve()
): () => void {
  if (controllerDisposer) return controllerDisposer;
  let disposed = false;
  const unsubscribeActivation = window.pi67.system.onNativeNotificationActivated((activation) => {
    void activateNativeNotificationWhenReady(activation, workbenchReady, () => disposed);
  });
  const unsubscribeWorkbench = rendererWorkbenchStore.subscribe(() => {
    dismissSelectedSessionNotifications();
  });
  const handleForeground = () => dismissSelectedSessionNotifications();
  window.addEventListener("focus", handleForeground);
  document.addEventListener("visibilitychange", handleForeground);
  controllerDisposer = () => {
    disposed = true;
    unsubscribeActivation();
    unsubscribeWorkbench();
    window.removeEventListener("focus", handleForeground);
    document.removeEventListener("visibilitychange", handleForeground);
    trackedNotifications.clear();
    trackedNotificationOrder.splice(0);
    controllerDisposer = undefined;
  };
  return controllerDisposer;
}

async function activateNativeNotificationWhenReady(
  activation: NativeNotificationActivation,
  workbenchReady: PromiseLike<void>,
  isDisposed: () => boolean
): Promise<void> {
  try {
    await workbenchReady;
    if (isDisposed()) return;
    await activateRendererNativeNotification(activation);
  } catch {
    if (isDisposed()) return;
    publishNotification({
      level: "warning",
      title: "无法打开通知对应的会话",
      message: "工作台尚未完成恢复，请在 Pi-67 中重新选择对应会话。"
    });
  }
}

export function handleNativeNotificationAgentEvent(
  event: AgentEvent,
  envelope: EventEnvelope,
  route: WorkbenchEventRoute
): void {
  const kind = nativeNotificationKind(event);
  if (
    !kind
    || typeof window === "undefined"
    || window.pi67?.system?.showNativeNotification === undefined
    || (route !== "background" && isRendererForeground())
  ) return;
  const authority = eventSessionAuthority(envelope);
  if (!authority?.operationId) return;
  const task = rendererWorkbenchStore.getState().tasks[authority.taskId];
  if (
    !task
    || task.workspaceId !== authority.workspaceId
    || task.taskGeneration !== authority.taskGeneration
    || task.sessionFileIdentity !== authority.sessionFileIdentity
    || task.sessionId !== authority.sessionId
    || task.sessionGeneration !== authority.sessionGeneration
  ) return;
  const request: NativeNotificationRequest = {
    notificationId: `native:${envelope.hostEpoch}:${authority.operationId}:${kind}`,
    kind,
    workspaceId: authority.workspaceId,
    sessionFileIdentity: authority.sessionFileIdentity
  };
  if (trackedNotifications.has(request.notificationId)) return;
  rememberTrackedNotification(request);
  void window.pi67.system.showNativeNotification(request).then((shown) => {
    if (!shown) forgetTrackedNotification(request.notificationId);
  }).catch(() => {
    forgetTrackedNotification(request.notificationId);
  });
}

export async function activateRendererNativeNotification(
  activation: NativeNotificationActivation
): Promise<boolean> {
  forgetTrackedNotification(activation.notificationId);
  void window.pi67.system.dismissNativeNotification(activation.notificationId).catch(() => false);
  const workbench = rendererWorkbenchStore.getState();
  const task = Object.values(workbench.tasks).find((candidate) => (
    candidate.workspaceId === activation.workspaceId
    && candidate.sessionFileIdentity === activation.sessionFileIdentity
    && candidate.conversation.kind === "session"
    && candidate.conversation.sessionFileIdentity === activation.sessionFileIdentity
  ));
  if (task) return activateRendererTask(task.id);

  const workspace = workbench.workspaces[activation.workspaceId];
  const session = selectWorkspaceSessionCatalog(
    useSessionCatalogStore.getState(),
    activation.workspaceId
  ).items.find((candidate) => candidate.fileIdentity === activation.sessionFileIdentity);
  if (workspace && session) {
    return openRendererWorkspaceDescriptor(workspace, session.path, session.fileIdentity);
  }

  publishNotification({
    level: "warning",
    title: "无法打开通知对应的会话",
    message: "会话可能已被移动、删除，或工作区目录尚未完成刷新。"
  });
  return false;
}

function dismissSelectedSessionNotifications(): void {
  if (!isRendererForeground()) return;
  const selected = selectedWorkbenchTask(rendererWorkbenchStore.getState());
  if (!selected?.sessionFileIdentity) return;
  for (const request of trackedNotifications.values()) {
    if (
      request.workspaceId !== selected.workspaceId
      || request.sessionFileIdentity !== selected.sessionFileIdentity
    ) continue;
    forgetTrackedNotification(request.notificationId);
    void window.pi67.system.dismissNativeNotification(request.notificationId).catch(() => false);
  }
}

function nativeNotificationKind(event: AgentEvent): NativeNotificationKind | undefined {
  switch (event.type) {
    case "operation.completed":
      return "completed";
    case "operation.failed":
      return "failed";
    case "operation.activityChanged":
      return event.payload.activity?.kind === "approval"
        || event.payload.activity?.kind === "extension-input"
        ? "attention"
        : undefined;
    default:
      return undefined;
  }
}

function isRendererForeground(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && document.hasFocus();
}

function rememberTrackedNotification(request: NativeNotificationRequest): void {
  trackedNotifications.set(request.notificationId, request);
  trackedNotificationOrder.push(request.notificationId);
  while (trackedNotificationOrder.length > MAX_TRACKED_NATIVE_NOTIFICATIONS) {
    const expired = trackedNotificationOrder.shift();
    if (expired) trackedNotifications.delete(expired);
  }
}

function forgetTrackedNotification(notificationId: string): void {
  trackedNotifications.delete(notificationId);
  const index = trackedNotificationOrder.indexOf(notificationId);
  if (index >= 0) trackedNotificationOrder.splice(index, 1);
}
