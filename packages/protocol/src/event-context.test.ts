import { describe, expect, it } from "vitest";
import type { RuntimeCapabilities } from "@pi67/domain";
import type { AgentEventType } from "./agent-messages.js";
import {
  EVENT_CONTEXT_REQUIREMENTS,
  correlateInvalidEvent,
  hasValidEventContext
} from "./event-context.js";
import {
  PROTOCOL_VERSION,
  APP_PROTOCOL_CONTEXT,
  eventEnvelope,
  isEventEnvelope,
  type EventEnvelope,
  type EventEnvelopeContext,
  type ProtocolContext
} from "./envelope.js";

const SESSION_SCOPED_EVENTS = Object.entries(EVENT_CONTEXT_REQUIREMENTS)
  .filter(([, requirement]) => requirement.session)
  .map(([type]) => type as AgentEventType);

const OPERATION_SCOPED_EVENTS = Object.entries(EVENT_CONTEXT_REQUIREMENTS)
  .filter(([, requirement]) => requirement.operation)
  .map(([type]) => type as AgentEventType);

describe("event context validation", () => {
  it("requires Session identity and generation for every Session-scoped event", () => {
    for (const type of SESSION_SCOPED_EVENTS) {
      expect(hasValidEventContext(eventShape(type)), type).toBe(false);
      expect(hasValidEventContext(eventShape(type, { sessionId: "session-1" })), type).toBe(false);
      expect(hasValidEventContext(eventShape(type, {
        sessionId: "session-1",
        sessionGeneration: 2
      })), type).toBe(false);
      expect(hasValidEventContext(eventShape(type, { sessionGeneration: 2 })), type).toBe(false);
    }
  });

  it("requires an Operation ID for every Operation-scoped event", () => {
    for (const type of OPERATION_SCOPED_EVENTS) {
      expect(hasValidEventContext(eventShape(type, {
        sessionId: "session-1",
        sessionFileIdentity: "session-file-1",
        sessionGeneration: 2
      })), type).toBe(false);
    }
  });

  it("keeps source-scoped events valid without Session context", () => {
    expect(isEventEnvelope(eventEnvelope("runtime.statusChanged", {
      phase: "ready",
      detail: "ready",
      recoverable: true
    }, { hostEpoch: 3, sequence: 1, context: APP_PROTOCOL_CONTEXT }))).toBe(true);
    expect(isEventEnvelope(eventEnvelope("session.catalog.changed", {
      revision: 4,
      reason: "reconciled"
    }, {
      hostEpoch: 3,
      sequence: 2,
      context: { scope: "workspace", workspaceId: "workspace-1" }
    }))).toBe(true);
  });

  it("cross-checks bootstrap, payload Session identity and Operation identity", () => {
    const ready = eventEnvelope("runtime.ready", {
      capabilities: runtimeCapabilities(),
      snapshot: emptySnapshot(),
      taskToolMode: "auto"
    }, sessionContext());
    expect(isEventEnvelope(ready)).toBe(true);
    expect(isEventEnvelope({
      ...ready,
      context: { ...ready.context, sessionId: "session-other" }
    })).toBe(false);
    expect(isEventEnvelope({
      ...ready,
      payload: {
        ...ready.payload,
        snapshot: { ...ready.payload.snapshot, sessionFileIdentity: "session-file-other" }
      }
    })).toBe(false);

    const conversation = eventEnvelope("conversation.changed", {
      sessionId: "session-1",
      reason: "settled"
    }, sessionContext());
    expect(isEventEnvelope(conversation)).toBe(true);
    expect(isEventEnvelope({
      ...conversation,
      payload: { ...conversation.payload, sessionId: "session-other" }
    })).toBe(false);
    const userAppended = eventEnvelope("conversation.changed", {
      sessionId: "session-1",
      reason: "user-appended"
    }, operationContext());
    expect(isEventEnvelope(userAppended)).toBe(true);
    expect(isEventEnvelope({
      ...userAppended,
      payload: { ...userAppended.payload, reason: "entry-appended" }
    })).toBe(false);

    const started = eventEnvelope("operation.started", {
      operation: {
        operationId: "operation-1",
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-1",
        sessionFileIdentity: "session-file-1",
        sessionGeneration: 2,
        startedAt: 100
      }
    }, operationContext());
    expect(isEventEnvelope(started)).toBe(true);
    expect(isEventEnvelope({
      ...started,
      payload: {
        operation: { ...started.payload.operation, sessionGeneration: 3 }
      }
    })).toBe(false);
    expect(isEventEnvelope({
      ...started,
      payload: {
        operation: { ...started.payload.operation, sessionFileIdentity: "session-file-other" }
      }
    })).toBe(false);

    const completed = eventEnvelope("operation.completed", {
      operationId: "operation-1",
      completedAt: 200
    }, operationContext());
    expect(isEventEnvelope(completed)).toBe(true);
    expect(isEventEnvelope({
      ...completed,
      context: { ...completed.context, operationId: "operation-other" }
    })).toBe(false);
  });

  it("cross-checks interactive payload authority against the envelope", () => {
    const approval = eventEnvelope("approval.requested", approvalPayload(), operationContext());
    expect(isEventEnvelope(approval)).toBe(true);
    expect(isEventEnvelope({
      ...approval,
      payload: { ...approval.payload, hostEpoch: 4 }
    })).toBe(false);

    const extension = eventEnvelope("extension.ui.requested", {
      requestId: "extension-1",
      hostEpoch: 3,
      sessionId: "session-1",
      sessionGeneration: 2,
      operationId: "operation-1",
      kind: "confirm",
      blocking: true
    }, operationContext());
    expect(isEventEnvelope(extension)).toBe(true);
    expect(isEventEnvelope({
      ...extension,
      payload: { ...extension.payload, operationId: undefined }
    })).toBe(false);
  });

  it("rejects stale Plan lifecycle lineage while allowing Session-scoped dismissal", () => {
    const requested = eventEnvelope("plan.lifecycleChanged", {
      phase: "implementation-requested",
      planId: "plan-1",
      sourceOperationId: "tool-call-1",
      submissionId: "submission-1",
      operationId: "operation-1",
      hostEpoch: 3,
      sessionId: "session-1",
      sessionFileIdentity: "session-file-1",
      sessionGeneration: 2,
      timestamp: 100
    }, operationContext());

    expect(isEventEnvelope(requested)).toBe(true);
    expect(isEventEnvelope({
      ...requested,
      payload: { ...requested.payload, hostEpoch: 4 }
    })).toBe(false);
    expect(isEventEnvelope({
      ...requested,
      payload: { ...requested.payload, operationId: "operation-other" }
    })).toBe(false);
    expect(isEventEnvelope({
      ...requested,
      payload: { ...requested.payload, sessionFileIdentity: "session-file-other" }
    })).toBe(false);

    expect(isEventEnvelope(eventEnvelope("plan.lifecycleChanged", {
      phase: "dismissed",
      planId: "plan-1",
      timestamp: 101
    }, sessionContext()))).toBe(true);
  });

  it("only correlates structurally event-shaped frames to a Host epoch", () => {
    expect(correlateInvalidEvent({ kind: "event", hostEpoch: 7 })).toEqual({ hostEpoch: 7 });
    expect(correlateInvalidEvent({ kind: "response", hostEpoch: 7 })).toBeUndefined();
    expect(correlateInvalidEvent({ kind: "event", hostEpoch: -1 })).toBeUndefined();
    expect(correlateInvalidEvent({ kind: "event", hostEpoch: "7" })).toBeUndefined();
  });
});

function eventShape(
  type: AgentEventType,
  authority: {
    sessionId?: string;
    sessionFileIdentity?: string;
    sessionGeneration?: number;
    operationId?: string;
  } = {}
): EventEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "event",
    hostEpoch: 3,
    sequence: 1,
    context: {
      scope: "task",
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskGeneration: 1,
      ...authority
    } as ProtocolContext,
    taskSequence: 1,
    type,
    payload: {} as never
  } as EventEnvelope;
}

function sessionContext(): EventEnvelopeContext {
  return {
    hostEpoch: 3,
    sequence: 1,
    context: {
      scope: "task",
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskGeneration: 1,
      sessionId: "session-1",
      sessionFileIdentity: "session-file-1",
      sessionGeneration: 2
    },
    taskSequence: 1
  };
}

function operationContext(): EventEnvelopeContext {
  return {
    ...sessionContext(),
    context: { ...sessionContext().context, operationId: "operation-1" }
  } as EventEnvelopeContext;
}

function approvalPayload() {
  return {
    requestId: "approval-1",
    hostEpoch: 3,
    sessionId: "session-1",
    sessionGeneration: 2,
    operationId: "operation-1",
    toolCallId: "tool-1",
    toolName: "bash",
    toolSource: "Pi 内置",
    category: "destructive-shell" as const,
    reason: "Shell commands require confirmation.",
    targetKind: "command" as const,
    target: "pnpm test",
    targetTruncated: false,
    cwd: "/workspace",
    cwdTruncated: false,
    scope: "single-tool-call" as const
  };
}

function runtimeCapabilities(): RuntimeCapabilities {
  return {
    sdkVersion: "0.81.1",
    supportsFollowUp: true,
    supportsSessionTree: true,
    extensionUi: {
      primitives: [],
      attribution: "none" as const,
      recognizedCompatibilityLevels: [],
      adapterRegistry: {
        available: false,
        manifestSchemaVersions: [],
        supportedSurfaces: [],
        realtimeUiAttribution: false,
        activeAdapterCount: 0
      },
      limitations: {
        workingIndicator: "unsupported" as const,
        editorMutation: "unsupported" as const,
        customComponents: "tui-only" as const,
        autocomplete: "tui-only" as const,
        widgetPlacements: ["aboveEditor" as const, "belowEditor" as const]
      }
    }
  };
}

function emptySnapshot() {
  return {
    sessionId: "session-1",
    sessionFileIdentity: "session-file-1",
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
