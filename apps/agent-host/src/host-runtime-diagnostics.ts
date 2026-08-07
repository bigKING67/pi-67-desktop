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
      writerLeases: options.writerLeases.diagnostics(),
      workspaces,
      workspacesTruncated: options.workspaceRecords.length > workspaces.length
    }
  };
}
