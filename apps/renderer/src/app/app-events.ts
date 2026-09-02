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
import {
  handleProjectProviderConfigurationChanged,
  handleProviderConfigurationChanged
} from "../settings/provider-configuration-controller.js";

export type RoutedAgentEvent = Exclude<AgentEvent, ProjectionAgentEvent>;

export function handleAgentEvent<TState extends AppEventState>(
  event: RoutedAgentEvent,
  envelope: EventEnvelope,
  get: EventStoreGet<TState>,
  set: EventStoreSet<TState>,
  onMissingSessionImportBootstrap?: (event: RoutedAgentEvent, envelope: EventEnvelope) => void
): boolean {
  const sessionAuthority = sessionAuthorityForEvent(event, envelope, get);
  if (requiresSessionAuthority(event.type) && !sessionAuthority) {
    onMissingSessionImportBootstrap?.(event, envelope);
    return false;
  }

  switch (event.type) {
    case "runtime.statusChanged":
    case "runtime.crashed":
    case "diagnostics.progress":
    case "doctor.completed":
      return reduceRuntimeEvent(event, set);
    case "turn.streamBatch":
    case "operation.started":
    case "operation.heartbeat":
    case "operation.activityChanged":
    case "operation.toolExecutionChanged":
    case "operation.progress":
    case "operation.completed":
    case "operation.failed":
    case "operation.cancelled":
    case "operation.lost":
      return reduceOperationEvent(event, envelope, get, set, sessionAuthority);
    case "approval.requested":
    case "approval.resolved":
    case "approval.cancelled":
    case "extension.ui.requested":
    case "extension.ui.updated":
    case "extension.ui.resolved":
    case "extension.ui.cancelled":
    case "extension.compatibilityChanged":
    case "extension.catalog.changed":
      return reduceInteractiveEvent(event, envelope, get);
    case "session.catalog.changed":
      if (envelope.context.scope !== "app") {
        handleSessionCatalogChanged(
          envelope.context.workspaceId,
          event.payload.revision,
          event.payload.reason
        );
      }
      return true;
    case "session.externalChangeDetected":
      publishNotification({
        level: "warning",
        title: "Pi 会话已在外部修改",
        message: externalSessionChangeMessage(event.payload.reason)
      });
      return true;
    case "provider.configuration.changed":
      if (envelope.context.scope === "app") handleProviderConfigurationChanged(event.payload);
      return true;
    case "provider.projectConfiguration.changed":
      if (envelope.context.scope === "workspace") {
        handleProjectProviderConfigurationChanged(envelope.context.workspaceId, event.payload);
      }
      return true;
    case "resource.changed":
      publishNotification({ level: "info", title: "Pi 资源已重新加载", toast: false });
      return true;
    case "task.toolMode.changed":
    case "subagent.changed":
    case "context.healthChanged":
    case "context.ownerLocked":
    case "context.configChanged":
    case "context.recallStarted":
    case "context.recallCompleted":
    case "context.captureQueued":
    case "context.captureFailed":
    case "context.commitCompleted":
    case "context.commitFailed":
    case "memory.diffAvailable":
    case "memory.forgetCompleted":
    case "experience.candidateCreated":
    case "experience.candidateAssemblyFailed":
    case "experience.candidateValidated":
    case "experience.candidatePromoted":
    case "experience.candidatePromotionFailed":
    case "experience.candidateRejected":
    case "enterprise.authChanged":
    case "enterprise.workspaceBindingChanged":
      return true;
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
    case "operation.toolExecutionChanged":
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
    case "subagent.changed":
      return true;
    default:
      return false;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Agent event: ${JSON.stringify(value)}`);
}
