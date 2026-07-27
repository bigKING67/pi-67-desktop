import type { AgentEventType, EventPayloads } from "./agent-messages.js";

interface EventContextRequirement {
  session: boolean;
  operation: boolean;
}

export const EVENT_CONTEXT_REQUIREMENTS = {
  "runtime.statusChanged": { session: false, operation: false },
  "runtime.ready": { session: true, operation: false },
  "runtime.crashed": { session: false, operation: false },
  "session.bootstrap": { session: true, operation: false },
  "conversation.changed": { session: true, operation: false },
  "queue.changed": { session: true, operation: false },
  "session.metaChanged": { session: true, operation: false },
  "tree.changed": { session: true, operation: false },
  "usage.changed": { session: true, operation: false },
  "session.catalog.changed": { session: false, operation: false },
  "session.externalChangeDetected": { session: true, operation: false },
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
  sessionId?: string;
  sessionGeneration?: number;
  operationId?: string;
}

type EventContextEnvelopeUnion = {
  [Type in AgentEventType]: EventContextEnvelope<Type>;
}[AgentEventType];

export function hasValidEventContext(envelope: EventContextEnvelope): boolean {
  const requirement = EVENT_CONTEXT_REQUIREMENTS[envelope.type];
  if (requirement.session && !hasSessionContext(envelope)) return false;
  if (requirement.operation && envelope.operationId === undefined) return false;

  const event = envelope as EventContextEnvelopeUnion;
  switch (event.type) {
    case "runtime.ready":
    case "session.bootstrap":
      return event.payload.snapshot.sessionId === event.sessionId;
    case "conversation.changed":
    case "workspace.changeChanged":
      return event.payload.sessionId === event.sessionId;
    case "operation.started":
      return event.payload.operation.operationId === event.operationId
        && event.payload.operation.sessionId === event.sessionId
        && event.payload.operation.sessionGeneration === event.sessionGeneration;
    case "operation.heartbeat":
      return event.payload.operationId === event.operationId
        && event.payload.lastActivityAt <= event.payload.observedAt;
    case "operation.activityChanged":
    case "operation.progress":
    case "operation.completed":
    case "operation.failed":
    case "operation.cancelled":
    case "operation.lost":
      return event.payload.operationId === event.operationId;
    case "approval.requested":
    case "extension.ui.requested":
    case "extension.ui.updated":
    case "extension.compatibilityChanged":
      return matchesInteractiveContext(event.payload, event);
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

function hasSessionContext(envelope: EventContextEnvelope): boolean {
  return envelope.sessionId !== undefined && envelope.sessionGeneration !== undefined;
}

function matchesInteractiveContext(
  payload: {
    hostEpoch?: number;
    sessionId?: string;
    sessionGeneration?: number;
    operationId?: string;
  },
  envelope: EventContextEnvelope
): boolean {
  return payload.hostEpoch === envelope.hostEpoch
    && payload.sessionId === envelope.sessionId
    && payload.sessionGeneration === envelope.sessionGeneration
    && payload.operationId === envelope.operationId;
}
