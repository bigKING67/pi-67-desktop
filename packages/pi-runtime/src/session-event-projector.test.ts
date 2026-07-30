import {
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type SessionEntry,
  type SessionStats
} from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { SessionEventProjector } from "./session-event-projector.js";

describe("SessionEventProjector", () => {
  it("refreshes Conversation projection when a user entry is appended, but not for assistant entries", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "session-event-projector" });
    const emitted: AgentEvent[] = [];
    const session = { sessionId: manager.getSessionId() } as AgentSession;
    const projector = new SessionEventProjector({
      getSession: () => session,
      getStats: () => ({}) as SessionStats,
      emit: (event) => emitted.push(event),
      emitActivity: vi.fn(),
      pushStream: vi.fn(),
      flushStream: vi.fn(),
      bindToolExecutionStart: vi.fn(() => "generic" as const),
      completeToolExecution: vi.fn(),
      settleActiveToolExecutions: vi.fn()
    });

    const userId = manager.appendMessage({ role: "user", content: "Run the task", timestamp: 1 });
    projector.handle(appended(manager.getEntry(userId)!));
    const assistantId = manager.appendMessage(assistantMessage("Working", 2));
    projector.handle(appended(manager.getEntry(assistantId)!));

    expect(emitted).toEqual([
      { type: "tree.changed", payload: { reason: "session-entry" } },
      {
        type: "conversation.changed",
        payload: { sessionId: manager.getSessionId(), reason: "user-appended" }
      },
      { type: "tree.changed", payload: { reason: "session-entry" } }
    ]);
  });
});

function appended(entry: SessionEntry): AgentSessionEvent {
  return { type: "entry_appended", entry };
}

function assistantMessage(text: string, timestamp: number) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-responses" as const,
    provider: "pi67-test",
    model: "fixture",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop" as const,
    timestamp
  };
}
