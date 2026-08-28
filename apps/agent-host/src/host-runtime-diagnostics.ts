import { createHash } from "node:crypto";
import type { AgentRuntime } from "@pi67/pi-runtime";
import type { RuntimeDiagnostics } from "@pi67/protocol";
import type { TaskHostState } from "./host-task-state-coordinator.js";
import type { SessionWriterLeaseRegistry } from "./session-writer-lease-registry.js";
import type { WorkspaceContextRecord } from "./workspace-context-registry.js";

export async function collectHostRuntimeDiagnostics(options: {
  runtime: AgentRuntime;
  hostEpoch: number;
  taskStates: readonly TaskHostState[];
  workspaceRecords: readonly WorkspaceContextRecord[];
  writerLeases: SessionWriterLeaseRegistry;
}): Promise<RuntimeDiagnostics> {
  const diagnostics = await options.runtime.collectDiagnostics();
  const taskStates = options.taskStates.filter((state) => !state.record.closed);
  const schedulers = taskStates.flatMap((state) => state.scheduler ? [state.scheduler.diagnostics()] : []);
  const operations = taskStates.flatMap((state) => state.operations ? [state.operations.diagnostics()] : []);
  const allInitializationReceipts = taskStates.flatMap((state) => state.initialization
    ? [{
        outcome: state.initialization.outcome,
        stages: state.initialization.stages.map((stage) => ({ ...stage })),
        stagesTruncated: state.initialization.stagesTruncated
      }]
    : []);
  const initializationReceipts = allInitializationReceipts.slice(0, 64);
  const workspaces = await Promise.all(options.workspaceRecords.slice(0, 64).map(async (workspace) => ({
    workspaceIdHash: createHash("sha256").update(workspace.workspaceId).digest("hex"),
    sessionCatalog: workspace.sessionCatalog.status(),
    sessionCreationJournal: await workspace.workspaceServices.sessionCreationReceipts.diagnostics()
  })));
  return {
    ...diagnostics,
    host: {
      hostEpoch: options.hostEpoch,
      taskCount: taskStates.length,
      liveRuntimeCount: taskStates.filter((state) => state.record.runtime !== undefined).length,
      activeOperationCount: taskStates.filter((state) => state.operations?.hasActive() ?? false).length,
      scheduler: {
        taskCount: schedulers.length,
        activeQueryCount: sum(schedulers, (state) => state.queryActive),
        queuedControlCount: sum(schedulers, (state) => state.controlQueued),
        runningControlCount: count(schedulers, (state) => state.controlRunning),
        queuedPromptCount: sum(schedulers, (state) => state.promptQueued),
        runningPromptCount: count(schedulers, (state) => state.promptRunning),
        turnAdmissionCount: count(schedulers, (state) => state.turnAdmission),
        closedCount: count(schedulers, (state) => state.closed)
      },
      operations: {
        registryCount: operations.length,
        acceptingCount: count(operations, (state) => state.accepting),
        activeCount: count(operations, (state) => state.active),
        terminatingCount: count(operations, (state) => state.terminating),
        poisonedCount: count(operations, (state) => state.poisoned),
        heartbeatTrackedCount: count(operations, (state) => state.heartbeat.active),
        maxQuietForMs: operations.reduce(
          (maximum, state) => Math.max(maximum, state.heartbeat.quietForMs ?? 0),
          0
        )
      },
      writerLeases: options.writerLeases.diagnostics(),
      initializationReceipts: {
        receipts: initializationReceipts,
        receiptsTruncated: allInitializationReceipts.length > initializationReceipts.length
      },
      workspaces,
      workspacesTruncated: options.workspaceRecords.length > workspaces.length
    }
  };
}

function sum<T>(values: readonly T[], select: (value: T) => number): number {
  return values.reduce((total, value) => total + select(value), 0);
}

function count<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  return values.reduce((total, value) => total + Number(predicate(value)), 0);
}
