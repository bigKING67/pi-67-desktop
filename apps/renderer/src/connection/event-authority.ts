import type { EventEnvelope } from "@pi67/protocol";

export interface EventTaskAuthority {
  workspaceId: string;
  taskId: string;
  taskGeneration: number;
}

export interface EventSessionAuthority extends EventTaskAuthority {
  sessionId: string;
  sessionGeneration: number;
  operationId?: string;
}

export function eventTaskAuthority(envelope: EventEnvelope): EventTaskAuthority | undefined {
  const context = envelope.context;
  if (context.scope !== "task") return undefined;
  return {
    workspaceId: context.workspaceId,
    taskId: context.taskId,
    taskGeneration: context.taskGeneration
  };
}

export function eventSessionAuthority(envelope: EventEnvelope): EventSessionAuthority | undefined {
  const context = envelope.context;
  if (
    context.scope !== "task"
    || context.sessionId === undefined
    || context.sessionGeneration === undefined
  ) return undefined;
  return {
    workspaceId: context.workspaceId,
    taskId: context.taskId,
    taskGeneration: context.taskGeneration,
    sessionId: context.sessionId,
    sessionGeneration: context.sessionGeneration,
    ...(context.operationId === undefined ? {} : { operationId: context.operationId })
  };
}
