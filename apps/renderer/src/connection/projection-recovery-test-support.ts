import { rendererWorkbenchStore } from "../workbench/workbench-store.js";

interface RecoveryTaskFixtureOptions {
  workspaceId?: string;
  taskId?: string;
  sessionFileIdentity?: string;
}

export function seedAuthoritativeRecoveryTask(
  options: RecoveryTaskFixtureOptions = {}
): void {
  const workspaceId = options.workspaceId ?? "workspace-1";
  const taskId = options.taskId ?? "task-1";
  const sessionFileIdentity = options.sessionFileIdentity ?? "session-file-session-1";
  const workbench = rendererWorkbenchStore.getState();
  workbench.registerWorkspace({
    id: workspaceId,
    displayName: "Workspace",
    identity: { canonicalPath: "/workspace", assurance: "filesystem" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  });
  workbench.openTask({
    id: taskId,
    conversation: {
      kind: "session",
      workspaceId,
      sessionFileIdentity,
      sessionPath: "/sessions/session-1.jsonl"
    },
    workspaceId,
    sessionId: "session-1",
    sessionFileIdentity,
    sessionPath: "/sessions/session-1.jsonl",
    sessionGeneration: 3,
    taskGeneration: 1,
    lifecycle: "lost",
    runtime: { phase: "failed", detail: "connection lost", recoverable: true },
    title: "Session",
    titleSource: "fallback",
    hasDraft: false,
    toolMode: "auto",
    attachmentCount: 0
  });
}
