import {
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type SessionStats
} from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { SessionEventProjector } from "./session-event-projector.js";

describe("SessionEventProjector", () => {
  it("refreshes Conversation after Pi persists a completed user message, but not for assistant messages", async () => {
    const manager = SessionManager.inMemory("/tmp", { id: "session-event-projector" });
    const emitted: AgentEvent[] = [];
    const session = { sessionId: manager.getSessionId(), sessionManager: manager } as AgentSession;
    const projector = new SessionEventProjector({
      getSession: () => session,
      getStats: () => ({}) as SessionStats,
      emit: (event) => emitted.push(event),
      emitActivity: vi.fn(),
      emitToolExecution: vi.fn(),
      reportToolExecutionReceiptFailure: vi.fn(),
      pushStream: vi.fn(),
      flushStream: vi.fn(),
      bindToolExecutionStart: vi.fn(() => "generic" as const),
      getToolAuthorization: vi.fn(),
      completeToolExecution: vi.fn(),
      settleActiveToolExecutions: vi.fn()
    });

    const user = { role: "user" as const, content: "Run the task", timestamp: 1 };
    projector.handle(messageEnded(user));
    expect(emitted).toEqual([]);
    manager.appendMessage(user);
    await Promise.resolve();
    projector.handle(messageEnded(assistantMessage("Working", 2)));

    expect(emitted).toEqual([
      { type: "tree.changed", payload: { reason: "session-entry" } },
      {
        type: "conversation.changed",
        payload: { sessionId: manager.getSessionId(), reason: "user-appended" }
      }
    ]);
  });

  it("drops a deferred user projection after the active Session is reset", async () => {
    const manager = SessionManager.inMemory("/tmp", { id: "session-event-projector-reset" });
    const emitted: AgentEvent[] = [];
    const session = { sessionId: manager.getSessionId(), sessionManager: manager } as AgentSession;
    const projector = new SessionEventProjector({
      getSession: () => session,
      getStats: () => ({}) as SessionStats,
      emit: (event) => emitted.push(event),
      emitActivity: vi.fn(),
      emitToolExecution: vi.fn(),
      reportToolExecutionReceiptFailure: vi.fn(),
      pushStream: vi.fn(),
      flushStream: vi.fn(),
      bindToolExecutionStart: vi.fn(() => "generic" as const),
      getToolAuthorization: vi.fn(),
      completeToolExecution: vi.fn(),
      settleActiveToolExecutions: vi.fn()
    });

    projector.handle(messageEnded({ role: "user", content: "stale", timestamp: 1 }));
    projector.reset();
    await Promise.resolve();

    expect(emitted).toEqual([]);
  });

  it("projects a late AUTO reason before clearing it at Tool completion", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "session-event-projector-tool" });
    const session = { sessionId: manager.getSessionId(), sessionManager: manager } as AgentSession;
    const activities = vi.fn();
    const authorization = { mode: "auto", reason: "read-only" } as const;
    const getToolAuthorization = vi.fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(authorization);
    const completeToolExecution = vi.fn();
    const projector = new SessionEventProjector({
      getSession: () => session,
      getStats: () => ({}) as SessionStats,
      emit: vi.fn(),
      emitActivity: activities,
      emitToolExecution: vi.fn(),
      reportToolExecutionReceiptFailure: vi.fn(),
      pushStream: vi.fn(),
      flushStream: vi.fn(),
      bindToolExecutionStart: vi.fn(() => "search" as const),
      getToolAuthorization,
      completeToolExecution,
      settleActiveToolExecutions: vi.fn()
    });

    projector.handle(toolEvent({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "grep",
      args: {}
    }));
    projector.recordToolAuthorization("tool-1", authorization);
    projector.handle(toolEvent({
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "grep",
      result: {},
      isError: false
    }));

    expect(activities.mock.calls.map(([activity]) => activity)).toEqual([
      { kind: "tool", toolCallId: "tool-1", toolName: "grep", toolKind: "search", status: "running" },
      {
        kind: "tool",
        toolCallId: "tool-1",
        toolName: "grep",
        toolKind: "search",
        status: "running",
        authorization
      },
      {
        kind: "tool",
        toolCallId: "tool-1",
        toolName: "grep",
        toolKind: "search",
        status: "completed",
        authorization
      }
    ]);
    expect(getToolAuthorization).toHaveBeenCalledTimes(2);
    expect(completeToolExecution).toHaveBeenCalledWith("tool-1");
  });
});

function toolEvent(value: object): AgentSessionEvent {
  return value as AgentSessionEvent;
}

function messageEnded(message: object): AgentSessionEvent {
  return { type: "message_end", message } as AgentSessionEvent;
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
