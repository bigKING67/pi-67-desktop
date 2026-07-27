import type { AgentSession, SessionStats } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "@pi67/protocol";

export function conversationChangedEvent(
  session: AgentSession,
  reason: "settled" | "compacted" | "rolled-back"
): AgentEvent<"conversation.changed"> {
  return { type: "conversation.changed", payload: { sessionId: session.sessionId, reason } };
}

export function queueChangedEvent(session: AgentSession): AgentEvent<"queue.changed"> {
  return {
    type: "queue.changed",
    payload: {
      steeringQueue: [...session.getSteeringMessages()],
      followUpQueue: [...session.getFollowUpMessages()]
    }
  };
}

export function sessionMetaChangedEvent(session: AgentSession): AgentEvent<"session.metaChanged"> {
  return {
    type: "session.metaChanged",
    payload: {
      streaming: session.isStreaming,
      thinkingLevel: session.thinkingLevel,
      ...(session.sessionName === undefined ? {} : { sessionName: session.sessionName }),
      ...(session.model === undefined ? {} : { selectedModel: { provider: session.model.provider, id: session.model.id } })
    }
  };
}

export function usageChangedEvent(stats: SessionStats): AgentEvent<"usage.changed"> {
  return {
    type: "usage.changed",
    payload: {
      tokens: stats.tokens.total,
      cost: stats.cost,
      ...(stats.contextUsage?.percent === null || stats.contextUsage?.percent === undefined
        ? {}
        : { contextPercent: stats.contextUsage.percent })
    }
  };
}
