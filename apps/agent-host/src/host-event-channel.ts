import type { AgentRuntime } from "@pi67/pi-runtime";
import {
  agentEventEnvelope,
  isEventEnvelope,
  type AgentEvent,
  type ProtocolContext,
  type TaskProtocolContext
} from "@pi67/protocol";
import type { HostConnectionContext } from "./connection-context.js";
import type { OperationRegistry } from "./operation-registry.js";

interface HostEventChannelDependencies {
  getConnection: () => HostConnectionContext | undefined;
  getHostEpoch: () => number;
  getOperations: () => OperationRegistry | undefined;
  getRuntime: () => AgentRuntime | undefined;
  getProtocolContext: () => ProtocolContext;
}

const MAX_INTERACTIVE_OPERATION_AUTHORITIES = 512;

export interface HostEventSendAuthority {
  runtime: AgentRuntime | undefined;
  operations: OperationRegistry | undefined;
  context: ProtocolContext;
}

export class HostEventChannel {
  private sequence = 0;
  private readonly taskSequences = new TaskEventSequenceRegistry();
  private readonly interactiveOperationIds = new Map<string, string>();
  private readonly outbox: Array<{ event: AgentEvent; authority: HostEventSendAuthority }> = [];
  private draining = false;

  constructor(private readonly dependencies: HostEventChannelDependencies) {}

  get eventSequence(): number {
    return this.sequence;
  }

  send(event: AgentEvent): boolean {
    return this.sendWithAuthority(event, {
      runtime: this.dependencies.getRuntime(),
      operations: this.dependencies.getOperations(),
      context: this.dependencies.getProtocolContext()
    });
  }

  sendFor(event: AgentEvent, authority: HostEventSendAuthority): boolean {
    return this.sendWithAuthority(event, authority);
  }

  private sendWithAuthority(event: AgentEvent, authority: HostEventSendAuthority): boolean {
    if (!hasEventShape(event)) return false;
    const queued = { event, authority };
    this.outbox.push(queued);
    if (this.draining) return true;

    this.draining = true;
    let initialResult = true;
    try {
      while (this.outbox.length > 0) {
        const current = this.outbox.shift();
        if (!current) break;
        const delivered = this.deliver(current.event, current.authority);
        if (current === queued) initialResult = delivered;
      }
    } finally {
      this.draining = false;
    }
    return initialResult;
  }

  private deliver(event: AgentEvent, authority: HostEventSendAuthority): boolean {
    const blockingInteractiveRequest = isBlockingInteractiveRequest(event);
    const runtime = authority.runtime;
    const identity = runtime?.getIdentity() ?? { sessionGeneration: 0 };
    const operations = authority.operations;
    const operationId = operationIdFor(event)
      ?? this.interactiveOperationIdFor(event, authority.context)
      ?? operations?.activeAccepted()?.operationId;
    const hostEpoch = this.dependencies.getHostEpoch();
    const protocolContext = enrichTaskContext(
      authority.context,
      identity,
      operationId
    );
    if (
      blockingInteractiveRequest
      && (
        identity.sessionId === undefined
        || identity.sessionFileIdentity === undefined
        || operationId === undefined
      )
    ) {
      rejectInteractiveRequest(runtime, event);
      return false;
    }
    const context = {
      hostEpoch,
      ...(identity.sessionId === undefined ? {} : { sessionId: identity.sessionId }),
      sessionGeneration: identity.sessionGeneration,
      ...(operationId === undefined ? {} : { operationId })
    };
    const contextualEvent = withInteractiveEventContext(event, context);
    const nextSequence = this.sequence + 1;
    const nextTaskSequence = protocolContext.scope === "task"
      ? this.taskSequences.next(protocolContext)
      : undefined;
    const envelope = protocolContext.scope === "task"
      ? agentEventEnvelope(contextualEvent, {
          hostEpoch,
          sequence: nextSequence,
          context: protocolContext,
          taskSequence: nextTaskSequence ?? 1
        })
      : agentEventEnvelope(contextualEvent, {
          hostEpoch,
          sequence: nextSequence,
          context: protocolContext
        });
    if (!isEventEnvelope(envelope)) {
      if (blockingInteractiveRequest) rejectInteractiveRequest(runtime, event);
      return false;
    }

    operations?.observeEventActivity(event);
    updateInteractiveActivity(operations, event);
    this.sequence = nextSequence;
    if (protocolContext.scope === "task" && nextTaskSequence !== undefined) {
      this.taskSequences.commit(protocolContext, nextTaskSequence);
    }
    this.recordInteractiveOperation(event, authority.context, operationId);
    const delivered = this.dependencies.getConnection()?.postEvent(envelope) ?? false;
    this.clearTerminalInteractiveOperations(event, authority.context);

    if (blockingInteractiveRequest && !delivered) {
      rejectInteractiveRequest(runtime, event);
      operations?.completeInteractiveWait(event.payload.requestId);
    }
    return true;
  }

  private interactiveOperationIdFor(event: AgentEvent, context: ProtocolContext): string | undefined {
    const requestIds = terminalInteractiveRequestIds(event);
    if (requestIds.length === 0) return undefined;
    const operationIds = new Set(requestIds.flatMap((requestId) => {
      const operationId = this.interactiveOperationIds.get(interactiveRequestKey(context, requestId));
      return operationId === undefined ? [] : [operationId];
    }));
    return operationIds.size === 1 ? operationIds.values().next().value : undefined;
  }

  private recordInteractiveOperation(
    event: AgentEvent,
    context: ProtocolContext,
    operationId: string | undefined
  ): void {
    if (operationId === undefined) return;
    const requestId = requestedInteractiveRequestId(event);
    if (requestId === undefined) return;
    const key = interactiveRequestKey(context, requestId);
    this.interactiveOperationIds.delete(key);
    this.interactiveOperationIds.set(key, operationId);
    while (this.interactiveOperationIds.size > MAX_INTERACTIVE_OPERATION_AUTHORITIES) {
      const oldest = this.interactiveOperationIds.keys().next().value;
      if (oldest === undefined) break;
      this.interactiveOperationIds.delete(oldest);
    }
  }

  private clearTerminalInteractiveOperations(event: AgentEvent, context: ProtocolContext): void {
    for (const requestId of terminalInteractiveRequestIds(event)) {
      this.interactiveOperationIds.delete(interactiveRequestKey(context, requestId));
    }
  }
}

class TaskEventSequenceRegistry {
  private readonly sequences = new Map<string, { generation: number; sequence: number }>();

  next(context: TaskProtocolContext): number {
    const current = this.sequences.get(taskSequenceKey(context));
    return current?.generation === context.taskGeneration ? current.sequence + 1 : 1;
  }

  commit(context: TaskProtocolContext, sequence: number): void {
    this.sequences.set(taskSequenceKey(context), { generation: context.taskGeneration, sequence });
  }
}

function taskSequenceKey(context: TaskProtocolContext): string {
  return JSON.stringify([context.workspaceId, context.taskId]);
}

function enrichTaskContext(
  context: ProtocolContext,
  identity: ReturnType<AgentRuntime["getIdentity"]>,
  operationId: string | undefined
): ProtocolContext {
  if (
    context.scope !== "task"
    || identity.sessionId === undefined
    || identity.sessionFileIdentity === undefined
  ) return context;
  return {
    scope: "task",
    workspaceId: context.workspaceId,
    taskId: context.taskId,
    taskGeneration: context.taskGeneration,
    sessionId: identity.sessionId,
    sessionFileIdentity: identity.sessionFileIdentity,
    sessionGeneration: identity.sessionGeneration,
    ...(operationId === undefined ? {} : { operationId })
  };
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
  if (event.type === "approval.requested") return true;
  if (event.type !== "extension.ui.requested") return false;
  const payload = recordOf(event.payload);
  return payload === undefined || payload.blocking !== false;
}

function rejectInteractiveRequest(
  runtime: AgentRuntime | undefined,
  event: Extract<AgentEvent, { type: "approval.requested" | "extension.ui.requested" }>
): void {
  const payload = recordOf(event.payload);
  const requestId = typeof payload?.requestId === "string" ? payload.requestId : undefined;
  if (requestId === undefined) {
    runtime?.cancelInteractiveRequests("abort");
    return;
  }
  if (event.type === "approval.requested") {
    const toolCallId = typeof payload?.toolCallId === "string" ? payload.toolCallId : undefined;
    if (toolCallId === undefined) {
      runtime?.cancelInteractiveRequests("abort");
      return;
    }
    if (runtime?.resolveApproval(requestId, toolCallId, "deny").resolved !== true) {
      runtime?.cancelInteractiveRequests("abort");
    }
  } else {
    if (runtime?.resolveExtensionUi(requestId, undefined, true) === false) {
      runtime.cancelInteractiveRequests("abort");
    }
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
  const payload = recordOf(event.payload) ?? {};
  return {
    type: event.type,
    payload: {
      ...payload,
      hostEpoch: context.hostEpoch,
      ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
      sessionGeneration: context.sessionGeneration,
      ...(context.operationId === undefined ? {} : { operationId: context.operationId })
    }
  } as AgentEvent;
}

function operationIdFor(event: AgentEvent): string | undefined {
  const payload = recordOf(event.payload);
  if (event.type === "plan.lifecycleChanged" && event.payload.phase !== "dismissed") {
    return event.payload.operationId;
  }
  if (event.type === "operation.started") {
    const operation = recordOf(payload?.operation);
    return typeof operation?.operationId === "string" ? operation.operationId : undefined;
  }
  if (event.type.startsWith("operation.")) {
    return typeof payload?.operationId === "string" ? payload.operationId : undefined;
  }
  return undefined;
}

function requestedInteractiveRequestId(event: AgentEvent): string | undefined {
  return event.type === "approval.requested" || event.type === "extension.ui.requested"
    ? event.payload.requestId
    : undefined;
}

function terminalInteractiveRequestIds(event: AgentEvent): string[] {
  if (event.type === "approval.resolved" || event.type === "extension.ui.resolved") {
    return [event.payload.requestId];
  }
  if (event.type === "approval.cancelled") {
    return event.payload.requests.map((request) => request.requestId);
  }
  return event.type === "extension.ui.cancelled" ? event.payload.requestIds : [];
}

function interactiveRequestKey(context: ProtocolContext, requestId: string): string {
  if (context.scope === "task") {
    return JSON.stringify([
      context.scope,
      context.workspaceId,
      context.taskId,
      context.taskGeneration,
      requestId
    ]);
  }
  if (context.scope === "workspace") {
    return JSON.stringify([context.scope, context.workspaceId, requestId]);
  }
  return JSON.stringify([context.scope, requestId]);
}

function hasEventShape(event: AgentEvent): boolean {
  const candidate = recordOf(event);
  return typeof candidate?.type === "string" && "payload" in candidate;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}
