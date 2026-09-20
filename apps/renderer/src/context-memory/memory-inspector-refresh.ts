import { agentConnectionController } from "../connection/AgentConnectionController.js";

/** One read at a time; a boundary arriving during a read invalidates that result. */
export function watchMemoryInspector(
  scope: { workspaceId: string | undefined; sessionId: string | undefined; sessionGeneration: number | undefined },
  refresh: (isCurrent: () => boolean) => Promise<void>,
  unavailable: (error: Error) => void,
): () => void {
  let active = true;
  let connected = true;
  let revision = 0;
  let running = false;
  let dirty = false;
  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (active && connected && dirty) {
        dirty = false;
        const readingRevision = revision;
        const isCurrent = () => active && connected && revision === readingRevision;
        try { await refresh(isCurrent); }
        catch (cause) {
          if (isCurrent()) unavailable(cause instanceof Error ? cause : new Error("无法读取记忆状态。"));
        }
      }
    } finally { running = false; }
  };
  const request = () => { if (active) { revision++; dirty = true; void drain(); } };
  const unsubscribe = agentConnectionController.subscribe({
    onConnected() { connected = true; request(); },
    onTeardown() {
      if (!active) return;
      connected = false; revision++; dirty = false;
      unavailable(new Error("连接已断开，记忆统计暂不可用；连接恢复后自动刷新。"));
    },
    onSequenceGap() {
      if (!active) return;
      unavailable(new Error("连接事件不完整，正在重新读取记忆统计。"));
      request();
    },
    onEvent(event, envelope) {
      const context = envelope.context;
      if (!scope.workspaceId || !scope.sessionId || context.scope === "app"
        || context.workspaceId !== scope.workspaceId) return;
      if (context.scope === "task") {
        if (context.sessionId !== scope.sessionId || context.sessionGeneration !== scope.sessionGeneration) return;
        if (event.type === "conversation.changed" && event.payload.sessionId === scope.sessionId
          && (event.payload.reason === "settled" || event.payload.reason === "compacted" || event.payload.reason === "rolled-back")) request();
      } else if ((event.type === "context.commitCompleted" || event.type === "context.commitFailed"
        || event.type === "context.recallCompleted" || event.type === "context.captureFailed")
        && event.payload.sessionId === scope.sessionId) request();
    },
  });
  request();
  return () => { active = false; revision++; unsubscribe(); };
}
