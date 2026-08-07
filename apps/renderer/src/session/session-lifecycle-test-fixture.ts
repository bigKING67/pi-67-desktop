export function sessionLifecycleTask(id: string, sessionPath: string) {
  return {
    id,
    conversation: {
      kind: "session" as const,
      workspaceId: "workspace-a",
      sessionFileIdentity: `session-file-${id}`,
      sessionPath
    },
    workspaceId: "workspace-a",
    sessionId: `session-${id}`,
    taskGeneration: 1,
    sessionGeneration: 2,
    lifecycle: "idle" as const,
    runtime: { phase: "ready" as const, detail: "Pi 会话已就绪", recoverable: true },
    title: id,
    sessionFileIdentity: `session-file-${id}`,
    sessionPath,
    hasDraft: false,
    toolMode: "auto" as const,
    attachmentCount: 0
  };
}
