import type {
  ApprovalRequestView,
  ExtensionCompatibilityEventView,
  ExtensionUiRequestView
} from "@pi67/domain";
import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import { currentApprovalTerminalRequestIds, type ApprovalTerminalIdentity } from "../approval/approval-event-authority.js";
import { useApprovalStore } from "../approval/approval-store.js";
import {
  hasCurrentInteractiveAuthority,
  hasCurrentInteractiveSessionAuthority,
  matchesInteractiveEnvelope
} from "../connection/interactive-authority.js";
import { stageRendererSessionExtensionCatalog } from "../extension-ui/extension-catalog-transition.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { acceptRendererSessionEvent } from "../session/session-authority.js";
import type { AppEventState, EventStoreGet } from "./app-event-state.js";

export function reduceInteractiveEvent<TState extends AppEventState>(
  event: AgentEvent,
  envelope: EventEnvelope,
  get: EventStoreGet<TState>
): boolean {
  switch (event.type) {
    case "approval.requested":
      if (isCurrentApprovalRequest(get(), event.payload, envelope)) {
        useApprovalStore.getState().upsertRequest(event.payload);
      }
      return true;
    case "extension.ui.requested":
      if (isCurrentInteractiveRequest(get(), event.payload, envelope)) {
        useExtensionUiStore.getState().upsertRequest(event.payload);
      }
      return true;
    case "extension.ui.updated":
      if (!isCurrentInteractivePayload(get(), event.payload, envelope)) return true;
      if (event.payload.kind === "notify" && event.payload.message) {
        publishNotification({
          level: event.payload.level ?? "info",
          title: "Extension 通知",
          message: event.payload.message,
          toast: event.payload.level === "warning" || event.payload.level === "error"
        });
        return true;
      }
      if (event.payload.kind === "working" || event.payload.kind === "editor-text") {
        publishNotification({
          level: "warning",
          title: "Extension UI 不受支持",
          message: "该 Extension 请求的 TUI 工作指示器或编辑器变更无法在 Desktop 中显示。"
        });
        return true;
      }
      useExtensionUiStore.getState().applyUpdate(event.payload);
      return true;
    case "approval.resolved":
      clearApprovalRequests([event.payload], envelope, get);
      return true;
    case "approval.cancelled":
      if (clearApprovalRequests(event.payload.requests, envelope, get) > 0 && event.payload.reason === "timeout") {
        publishNotification({
          level: "warning",
          title: messages.approval.requestTimeoutTitle,
          message: messages.approval.requestTimeoutMessage
        });
      }
      return true;
    case "extension.ui.resolved":
      clearExtensionRequests([event.payload.requestId], envelope, get);
      return true;
    case "extension.ui.cancelled":
      if (clearExtensionRequests(event.payload.requestIds, envelope, get) > 0 && event.payload.reason === "timeout") {
        publishNotification({
          level: "warning",
          title: messages.extensionUi.requestTimeoutTitle,
          message: messages.extensionUi.requestTimeoutMessage
        });
      }
      return true;
    case "extension.compatibilityChanged":
      if (!isCurrentInteractivePayload(get(), event.payload, envelope)) return true;
      useExtensionUiStore.getState().applyCompatibility(event.payload);
      if (event.payload.status !== "partial") {
        publishNotification({
          level: "warning",
          title: "Extension 兼容性受限",
          message: event.payload.detail
        });
      }
      return true;
    case "extension.catalog.changed": {
      const acceptance = acceptRendererSessionEvent(get(), envelope);
      if (acceptance) {
        useExtensionUiStore.getState().installCatalog(acceptance, event.payload);
      } else {
        stageRendererSessionExtensionCatalog(get(), envelope, event.payload);
      }
      return true;
    }
    default:
      return false;
  }
}

function isCurrentApprovalRequest(
  state: AppEventState,
  request: ApprovalRequestView,
  envelope: EventEnvelope
): boolean {
  return request.operationId !== undefined
    && isCurrentInteractiveRequest(state, request, envelope);
}

function isCurrentInteractiveRequest(
  state: AppEventState,
  request: ApprovalRequestView | ExtensionUiRequestView,
  envelope: EventEnvelope
): boolean {
  return isCurrentInteractivePayload(state, request, envelope);
}

function isCurrentInteractivePayload(
  state: AppEventState,
  payload: ApprovalRequestView | ExtensionUiRequestView | ExtensionCompatibilityEventView,
  envelope: EventEnvelope
): boolean {
  return hasCurrentInteractiveAuthority(state, payload)
    && matchesInteractiveEnvelope(payload, envelope);
}

function clearApprovalRequests<TState extends AppEventState>(
  requests: ApprovalTerminalIdentity[],
  envelope: EventEnvelope,
  get: EventStoreGet<TState>
): number {
  const ids = currentApprovalTerminalRequestIds(
    get(),
    useApprovalStore.getState().requests,
    requests,
    envelope
  );
  if (ids.length === 0) return 0;
  useApprovalStore.getState().removeRequests(ids);
  return ids.length;
}

function clearExtensionRequests<TState extends AppEventState>(
  requestIds: string[],
  envelope: EventEnvelope,
  get: EventStoreGet<TState>
): number {
  const ids = useExtensionUiStore.getState().requests.flatMap((request) => (
    requestIds.includes(request.requestId)
      && hasCurrentInteractiveSessionAuthority(get(), request)
      && matchesInteractiveEnvelope(request, envelope)
      ? [request.requestId]
      : []
  ));
  if (ids.length > 0) useExtensionUiStore.getState().cancelRequests(ids);
  return ids.length;
}
