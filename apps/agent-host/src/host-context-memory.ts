import type { AgentHostServerOptions } from "./host-server-contract.js";
import type { HostEventChannel } from "./host-event-channel.js";
import type { WorkspaceContextRegistry } from "./workspace-context-registry.js";
import type { TaskRuntimeRegistry } from "./task-runtime-registry.js";
import { ContextMemoryCommandRouter } from "./context/context-memory-command-router.js";
import { ManagedMemoryInspection } from "./context/managed-memory-inspection.js";

export type HostContextMemory = ContextMemoryCommandRouter;

export function createHostContextMemory(agentDir: string, workspaces: WorkspaceContextRegistry,
  events: HostEventChannel, tasks: TaskRuntimeRegistry, options: AgentHostServerOptions) {
  return new ContextMemoryCommandRouter(agentDir, workspaces, events, options.enterpriseCredentialBroker,
    (workspaceId, sessionId) => tasks.commitPrivateMemory(workspaceId, sessionId),
    options.managedLocalMemory ? new ManagedMemoryInspection(
      () => options.localMemoryBroker?.inspect() ?? Promise.reject(new Error("Managed memory broker is unavailable.")),
      (workspaceId, sessionId) => tasks.inspectPrivateMemory(workspaceId, sessionId)
    ) : undefined);
}
