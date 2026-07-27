import type { AgentRuntime } from "@pi67/pi-runtime";
import { agentEventEnvelope, type AgentEvent } from "@pi67/protocol";
import type { HostConnectionContext } from "./connection-context.js";
import type { OperationRegistry } from "./operation-registry.js";

interface HostEventChannelDependencies {
  getConnection: () => HostConnectionContext | undefined;
  getHostEpoch: () => number;
  getOperations: () => OperationRegistry | undefined;
  getRuntime: () => AgentRuntime | undefined;
}

export class HostEventChannel {
  private sequence = 0;

  constructor(private readonly dependencies: HostEventChannelDependencies) {}

  get eventSequence(): number {
    return this.sequence;
  }

  send(event: AgentEvent): void {
    const runtime = this.dependencies.getRuntime();
    const identity = runtime?.getIdentity() ?? { sessionGeneration: 0 };
    const operations = this.dependencies.getOperations();
    const operationId = operationIdFor(event) ?? operations?.activeAccepted()?.operationId;
    const hostEpoch = this.dependencies.getHostEpoch();
    if (
      isBlockingInteractiveRequest(event)
      && (identity.sessionId === undefined || operationId === undefined)
    ) {
      rejectInteractiveRequest(runtime, event);
      return;
    }
    operations?.observeEventActivity(event);
    updateInteractiveActivity(operations, event);

    this.sequence += 1;
    const context = {
      hostEpoch,
      ...(identity.sessionId === undefined ? {} : { sessionId: identity.sessionId }),
      sessionGeneration: identity.sessionGeneration,
      ...(operationId === undefined ? {} : { operationId })
    };
    const contextualEvent = withInteractiveEventContext(event, context);
    const delivered = this.dependencies.getConnection()?.postEvent(agentEventEnvelope(contextualEvent, {
      hostEpoch,
      sequence: this.sequence,
      ...(identity.sessionId === undefined ? {} : { sessionId: identity.sessionId }),
      sessionGeneration: identity.sessionGeneration,
      ...(operationId === undefined ? {} : { operationId })
    })) ?? false;

    if (isBlockingInteractiveRequest(event) && !delivered) {
      rejectInteractiveRequest(runtime, event);
      operations?.completeInteractiveWait(event.payload.requestId);
    }
  }
}

function updateInteractiveActivity(operations: OperationRegistry | undefined, event: AgentEvent): void {
  if (event.type === "approval.requested") {
    operations?.beginInteractiveWait({ kind: "approval", requestId: event.payload.requestId });
    return;
  }
  if (event.type === "extension.ui.requested" && event.payload.blocking) {
    operations?.beginInteractiveWait({ kind: "extension-input", requestId: event.payload.requestId });
    return;
  }
  if (event.type === "approval.resolved") {
    operations?.completeInteractiveWait(event.payload.requestId);
    return;
  }
  if (event.type === "approval.cancelled") {
    event.payload.requests.forEach((request) => operations?.completeInteractiveWait(request.requestId));
    return;
  }
  if (event.type === "extension.ui.resolved") {
    operations?.completeInteractiveWait(event.payload.requestId);
    return;
  }
  if (event.type === "extension.ui.cancelled") {
    event.payload.requestIds.forEach((requestId) => operations?.completeInteractiveWait(requestId));
  }
}

function isBlockingInteractiveRequest(
  event: AgentEvent
): event is Extract<AgentEvent, { type: "approval.requested" | "extension.ui.requested" }> {
  return event.type === "approval.requested"
    || (event.type === "extension.ui.requested" && event.payload.blocking);
}

function rejectInteractiveRequest(
  runtime: AgentRuntime | undefined,
  event: Extract<AgentEvent, { type: "approval.requested" | "extension.ui.requested" }>
): void {
  if (event.type === "approval.requested") {
    runtime?.resolveApproval(event.payload.requestId, event.payload.toolCallId, false);
  } else {
    runtime?.resolveExtensionUi(event.payload.requestId, undefined, true);
  }
}

function withInteractiveEventContext(
  event: AgentEvent,
  context: { hostEpoch: number; sessionId?: string; sessionGeneration: number; operationId?: string }
): AgentEvent {
  if (
    event.type !== "approval.requested"
    && event.type !== "extension.ui.requested"
    && event.type !== "extension.ui.updated"
    && event.type !== "extension.compatibilityChanged"
  ) return event;
  return {
    type: event.type,
    payload: {
      ...event.payload,
      hostEpoch: context.hostEpoch,
      ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
      sessionGeneration: context.sessionGeneration,
      ...(context.operationId === undefined ? {} : { operationId: context.operationId })
    }
  } as AgentEvent;
}

function operationIdFor(event: AgentEvent): string | undefined {
  if (event.type === "operation.started") return event.payload.operation.operationId;
  if (event.type.startsWith("operation.")) return (event.payload as { operationId: string }).operationId;
  return undefined;
}
