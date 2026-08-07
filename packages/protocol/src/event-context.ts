import type { AgentEventType, EventPayloads } from "./agent-messages.js";
import type { ProtocolContext, TaskProtocolContext } from "./protocol-context.js";

interface EventContextRequirement {
  session: boolean;
  operation: boolean;
  requiredScope?: ProtocolContext["scope"];
}

export const EVENT_CONTEXT_REQUIREMENTS = {
  "runtime.statusChanged": { session: false, operation: false },
  "runtime.ready": { session: true, operation: false },
  "runtime.crashed": { session: false, operation: false },
  "session.bootstrap": { session: true, operation: false },
  "conversation.changed": { session: true, operation: false },
  "queue.changed": { session: true, operation: false },
  "session.metaChanged": { session: true, operation: false },
  "model.catalog.changed": { session: true, operation: false },
  "tree.changed": { session: true, operation: false },
  "usage.changed": { session: true, operation: false },
  "session.catalog.changed": { session: false, operation: false, requiredScope: "workspace" },
  "session.externalChangeDetected": { session: true, operation: false },
  "provider.configuration.changed": { session: false, operation: false, requiredScope: "workspace" },
  "turn.streamBatch": { session: true, operation: true },
  "operation.started": { session: true, operation: true },
  "operation.heartbeat": { session: true, operation: true },
  "operation.activityChanged": { session: true, operation: true },
  "operation.progress": { session: true, operation: true },
  "operation.completed": { session: true, operation: true },
  "operation.failed": { session: true, operation: true },
  "operation.cancelled": { session: true, operation: true },
  "operation.lost": { session: true, operation: true },
  "workspace.changeChanged": { session: true, operation: false },
  "approval.requested": { session: true, operation: true },
  "approval.resolved": { session: true, operation: true },
  "approval.cancelled": { session: true, operation: true },
  "task.toolMode.changed": { session: true, operation: false },
  "extension.ui.requested": { session: true, operation: false },
  "extension.ui.updated": { session: true, operation: false },
  "extension.ui.resolved": { session: true, operation: false },
  "extension.ui.cancelled": { session: true, operation: false },
  "extension.compatibilityChanged": { session: true, operation: false },
  "extension.catalog.changed": { session: true, operation: false },
  "resource.changed": { session: true, operation: false },
  "diagnostics.progress": { session: false, operation: false },
  "doctor.completed": { session: false, operation: false }
} as const satisfies Record<AgentEventType, EventContextRequirement>;

export interface EventContextEnvelope<Type extends AgentEventType = AgentEventType> {
  hostEpoch: number;
  type: Type;
  payload: EventPayloads[Type];
  context: ProtocolContext;
}

type EventContextEnvelopeUnion = {
  [Type in AgentEventType]: EventContextEnvelope<Type>;
}[AgentEventType];

export function hasValidEventContext(envelope: EventContextEnvelope): boolean {
  const requirement: EventContextRequirement = EVENT_CONTEXT_REQUIREMENTS[envelope.type];
  const taskContext = envelope.context.scope === "task" ? envelope.context : undefined;
  if (requirement.requiredScope !== undefined && envelope.context.scope !== requirement.requiredScope) return false;
  if (requirement.session && !hasSessionContext(taskContext)) return false;
  if (requirement.operation && taskContext?.operationId === undefined) return false;

  const event = envelope as EventContextEnvelopeUnion;
  switch (event.type) {
    case "runtime.ready":
    case "session.bootstrap":
      return event.payload.snapshot.sessionId === taskContext?.sessionId
        && event.payload.snapshot.sessionFileIdentity === taskContext.sessionFileIdentity;
    case "conversation.changed":
    case "workspace.changeChanged":
      return event.payload.sessionId === taskContext?.sessionId;
    case "operation.started":
      return event.payload.operation.operationId === taskContext?.operationId
        && event.payload.operation.sessionId === taskContext.sessionId
        && event.payload.operation.sessionFileIdentity === taskContext.sessionFileIdentity
        && event.payload.operation.sessionGeneration === taskContext.sessionGeneration;
    case "operation.heartbeat":
      return event.payload.operationId === taskContext?.operationId
        && event.payload.lastActivityAt <= event.payload.observedAt;
    case "operation.activityChanged":
    case "operation.progress":
    case "operation.completed":
    case "operation.failed":
    case "operation.cancelled":
    case "operation.lost":
      return event.payload.operationId === taskContext?.operationId;
    case "approval.requested":
    case "extension.ui.requested":
    case "extension.ui.updated":
    case "extension.compatibilityChanged":
      return matchesInteractiveContext(event.payload, event.hostEpoch, taskContext);
    default:
      return true;
  }
}

export function correlateInvalidEvent(value: unknown): { hostEpoch: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.kind !== "event"
    || !Number.isSafeInteger(candidate.hostEpoch)
    || Number(candidate.hostEpoch) < 0
  ) return undefined;
  return { hostEpoch: Number(candidate.hostEpoch) };
}

function hasSessionContext(context: TaskProtocolContext | undefined): context is TaskProtocolContext & {
  sessionId: string;
  sessionFileIdentity: string;
  sessionGeneration: number;
} {
  return context?.sessionId !== undefined
    && context.sessionFileIdentity !== undefined
    && context.sessionGeneration !== undefined;
}

function matchesInteractiveContext(
  payload: {
    hostEpoch?: number;
    sessionId?: string;
    sessionGeneration?: number;
    operationId?: string;
  },
  hostEpoch: number,
  context: TaskProtocolContext | undefined
): boolean {
  return payload.hostEpoch === hostEpoch
    && payload.sessionId === context?.sessionId
    && payload.sessionGeneration === context?.sessionGeneration
    && payload.operationId === context?.operationId;
}
