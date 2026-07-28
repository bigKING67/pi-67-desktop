import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import { handleSessionCatalogChanged } from "../navigation/session-catalog-controller.js";
import { publishNotification } from "../notifications/notification-store.js";
import {
  acceptRendererSessionEvent,
  type RendererSessionAuthority
} from "../session/session-authority.js";
import type { AppEventState, EventStoreGet, EventStoreSet } from "./app-event-state.js";
import { externalSessionChangeMessage } from "./external-session-change-notification.js";
import type { ProjectionAgentEvent } from "./incremental-projection.js";
import { reduceInteractiveEvent } from "./interactive-event-reducer.js";
import { reduceOperationEvent } from "./operation-event-reducer.js";
import { reduceRuntimeEvent } from "./runtime-event-reducer.js";
import { handleProviderConfigurationChanged } from "../settings/provider-configuration-controller.js";

export type RoutedAgentEvent = Exclude<AgentEvent, ProjectionAgentEvent>;

export function handleAgentEvent<TState extends AppEventState>(
  event: RoutedAgentEvent,
  envelope: EventEnvelope,
  get: EventStoreGet<TState>,
  set: EventStoreSet<TState>,
  onMissingSessionImportBootstrap?: (event: RoutedAgentEvent, envelope: EventEnvelope) => void
): void {
  const sessionAuthority = sessionAuthorityForEvent(event, envelope, get);
  if (requiresSessionAuthority(event.type) && !sessionAuthority) {
    onMissingSessionImportBootstrap?.(event, envelope);
    return;
  }

  switch (event.type) {
    case "runtime.statusChanged":
    case "runtime.crashed":
    case "diagnostics.progress":
    case "doctor.completed":
      reduceRuntimeEvent(event, set);
      return;
    case "turn.streamBatch":
    case "operation.started":
    case "operation.heartbeat":
    case "operation.activityChanged":
    case "operation.progress":
    case "operation.completed":
    case "operation.failed":
    case "operation.cancelled":
    case "operation.lost":
      reduceOperationEvent(event, envelope, get, set, sessionAuthority);
      return;
    case "approval.requested":
    case "approval.resolved":
    case "approval.cancelled":
    case "extension.ui.requested":
    case "extension.ui.updated":
    case "extension.ui.resolved":
    case "extension.ui.cancelled":
    case "extension.compatibilityChanged":
    case "extension.catalog.changed":
      reduceInteractiveEvent(event, envelope, get);
      return;
    case "session.catalog.changed":
      if (envelope.context.scope !== "app") {
        handleSessionCatalogChanged(envelope.context.workspaceId, event.payload.revision);
      }
      return;
    case "session.externalChangeDetected":
      publishNotification({
        level: "warning",
        title: "Pi 会话已在外部修改",
        message: externalSessionChangeMessage(event.payload.reason)
      });
      return;
    case "provider.configuration.changed":
      if (envelope.context.scope === "workspace") {
        handleProviderConfigurationChanged(envelope.context.workspaceId, event.payload);
      }
      return;
    case "resource.changed":
      publishNotification({ level: "info", title: "Pi 资源已重新加载" });
      return;
    default:
      assertNever(event);
  }
}

function sessionAuthorityForEvent<TState extends AppEventState>(
  event: RoutedAgentEvent,
  envelope: EventEnvelope,
  get: EventStoreGet<TState>
): RendererSessionAuthority | undefined {
  return requiresSessionAuthority(event.type)
    ? acceptRendererSessionEvent(get(), envelope)
    : undefined;
}

function requiresSessionAuthority(type: RoutedAgentEvent["type"]): boolean {
  switch (type) {
    case "turn.streamBatch":
    case "operation.started":
    case "operation.heartbeat":
    case "operation.activityChanged":
    case "operation.progress":
    case "operation.completed":
    case "operation.failed":
    case "operation.cancelled":
    case "operation.lost":
    case "approval.requested":
    case "approval.resolved":
    case "approval.cancelled":
    case "extension.ui.requested":
    case "extension.ui.updated":
    case "extension.ui.resolved":
    case "extension.ui.cancelled":
    case "extension.compatibilityChanged":
    case "session.externalChangeDetected":
    case "resource.changed":
      return true;
    default:
      return false;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Agent event: ${JSON.stringify(value)}`);
}
