import type { EventEnvelopeContext } from "@pi67/protocol";

interface TaskEventFixtureOptions {
  hostEpoch: number;
  sequence: number;
  workspaceId?: string;
  taskId?: string;
  taskGeneration?: number;
  taskSequence?: number;
  sessionId?: string;
  sessionGeneration?: number;
  operationId?: string;
}

export function taskEventFixture(options: TaskEventFixtureOptions): EventEnvelopeContext {
  const context = options.sessionId === undefined || options.sessionGeneration === undefined
    ? {
        scope: "task" as const,
        workspaceId: options.workspaceId ?? "workspace-fixture",
        taskId: options.taskId ?? "task-fixture",
        taskGeneration: options.taskGeneration ?? 1
      }
    : {
        scope: "task" as const,
        workspaceId: options.workspaceId ?? "workspace-fixture",
        taskId: options.taskId ?? "task-fixture",
        taskGeneration: options.taskGeneration ?? 1,
        sessionId: options.sessionId,
        sessionGeneration: options.sessionGeneration,
        ...(options.operationId === undefined ? {} : { operationId: options.operationId })
      };
  return {
    hostEpoch: options.hostEpoch,
    sequence: options.sequence,
    context,
    taskSequence: options.taskSequence ?? options.sequence
  };
}
