import {
  APP_PROTOCOL_CONTEXT,
  commandEnvelope as protocolCommandEnvelope,
  type AgentCommandType,
  type CommandPayloads,
  type ProtocolContext,
  type RequestEnvelope,
  type TaskProtocolContext,
  type WorkspaceProtocolContext
} from "@pi67/protocol";

export const TEST_APP_CONTEXT = APP_PROTOCOL_CONTEXT;

export const TEST_WORKSPACE_CONTEXT: WorkspaceProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-test"
};

export const TEST_TASK_CONTEXT: TaskProtocolContext = {
  scope: "task",
  workspaceId: "workspace-test",
  taskId: "task-test",
  taskGeneration: 1
};

export function testTaskContext(
  taskGeneration = 1,
  overrides: Partial<Omit<TaskProtocolContext, "scope" | "taskGeneration">> = {}
): TaskProtocolContext {
  const base = {
    scope: "task" as const,
    workspaceId: overrides.workspaceId ?? TEST_TASK_CONTEXT.workspaceId,
    taskId: overrides.taskId ?? TEST_TASK_CONTEXT.taskId,
    taskGeneration
  };
  if (overrides.sessionId === undefined || overrides.sessionGeneration === undefined) return base;
  return {
    ...base,
    sessionId: overrides.sessionId,
    sessionGeneration: overrides.sessionGeneration,
    ...(overrides.operationId === undefined ? {} : { operationId: overrides.operationId })
  };
}

export function commandEnvelope<T extends AgentCommandType>(
  type: T,
  payload: CommandPayloads[T],
  hostEpoch = 0,
  idempotencyKey?: string
): RequestEnvelope<T> {
  return protocolCommandEnvelope(type, payload, TEST_TASK_CONTEXT, hostEpoch, idempotencyKey);
}

export function commandEnvelopeForContext<T extends AgentCommandType>(
  type: T,
  payload: CommandPayloads[T],
  context: ProtocolContext,
  hostEpoch = 0,
  idempotencyKey?: string
): RequestEnvelope<T> {
  return protocolCommandEnvelope(type, payload, context, hostEpoch, idempotencyKey);
}
