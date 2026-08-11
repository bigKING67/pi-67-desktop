import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ToolExecutionView } from "@pi67/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolExecutionProjector } from "./tool-execution-projector.js";

describe("ToolExecutionProjector", () => {
  afterEach(() => vi.useRealTimers());

  it("projects start, throttled progress, and the real terminal result", () => {
    vi.useFakeTimers();
    let now = 10;
    const emitted: ToolExecutionView[] = [];
    const receipts = vi.fn();
    const projector = new ToolExecutionProjector({
      emit: (execution) => emitted.push(execution),
      getCwd: () => "/workspace",
      persistReceipt: receipts,
      reportReceiptFailure: vi.fn(),
      now: () => now
    });

    projector.handle(event({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "pnpm test", token: "private" }
    }), "shell");
    projector.handle(event({
      type: "tool_execution_update",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "pnpm test" },
      partialResult: { content: [{ text: "running tests" }] }
    }));

    expect(emitted).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(emitted.at(-1)).toMatchObject({
      toolCallId: "tool-1",
      status: "running",
      command: { text: "pnpm test" },
      cwd: "/workspace",
      progress: { text: "running tests" }
    });

    now = 35;
    projector.handle(event({
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "bash",
      result: { error: { message: "exit code 1" } },
      isError: true
    }));
    expect(emitted.at(-1)).toMatchObject({
      status: "failed",
      resultState: "present",
      startedAt: 10,
      completedAt: 35,
      durationMs: 25,
      failure: { detailState: "available", message: { text: "exit code 1" } }
    });

    projector.handle(event({ type: "agent_settled" }));
    expect(receipts).toHaveBeenCalledWith({
      items: [{
        toolCallId: "tool-1",
        toolName: "bash",
        startedAt: 10,
        completedAt: 35,
        status: "failed"
      }]
    });
  });

  it("updates parallel tools by id and settles unfinished work as interrupted", () => {
    let now = 1;
    const emitted: ToolExecutionView[] = [];
    const receipts = vi.fn();
    const projector = new ToolExecutionProjector({
      emit: (execution) => emitted.push(execution),
      getCwd: () => undefined,
      persistReceipt: receipts,
      reportReceiptFailure: vi.fn(),
      now: () => now
    });

    projector.handle(start("a", "read"), "read");
    now = 2;
    projector.handle(start("b", "grep"), "search");
    now = 5;
    projector.handle(end("a", "read", false));
    now = 8;
    projector.handle(event({ type: "agent_settled" }));

    expect(emitted.filter((execution) => execution.toolCallId === "a").at(-1)?.status).toBe("completed");
    expect(emitted.filter((execution) => execution.toolCallId === "b").at(-1)?.status).toBe("interrupted");
    expect(receipts).toHaveBeenCalledWith({ items: [
      { toolCallId: "a", toolName: "read", startedAt: 1, completedAt: 5, status: "completed" },
      { toolCallId: "b", toolName: "grep", startedAt: 2, completedAt: 8, status: "interrupted" }
    ] });
  });

  it("records cancellation and exposes receipt persistence failure without raw errors", () => {
    let now = 10;
    const reportReceiptFailure = vi.fn();
    const emitted: ToolExecutionView[] = [];
    const projector = new ToolExecutionProjector({
      emit: (execution) => emitted.push(execution),
      getCwd: () => undefined,
      persistReceipt: () => { throw new Error("private path"); },
      reportReceiptFailure,
      now: () => now
    });

    projector.handle(start("tool-1", "bash"), "shell");
    projector.requestCancellation();
    now = 20;
    projector.handle(event({ type: "agent_settled" }));

    expect(emitted.at(-1)?.status).toBe("cancelled");
    expect(reportReceiptFailure).toHaveBeenCalledOnce();
  });
});

function event(value: object): AgentSessionEvent {
  return value as AgentSessionEvent;
}

function start(toolCallId: string, toolName: string): AgentSessionEvent {
  return event({ type: "tool_execution_start", toolCallId, toolName, args: {} });
}

function end(toolCallId: string, toolName: string, isError: boolean): AgentSessionEvent {
  return event({ type: "tool_execution_end", toolCallId, toolName, result: {}, isError });
}
