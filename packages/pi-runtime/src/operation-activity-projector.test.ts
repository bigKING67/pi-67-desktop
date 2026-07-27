import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { RuntimeOperationActivity } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { OperationActivityProjector } from "./operation-activity-projector.js";

describe("OperationActivityProjector", () => {
  it("projects thinking, response and compaction from Pi lifecycle events", () => {
    const activities: RuntimeOperationActivity[] = [];
    const projector = new OperationActivityProjector((activity) => activities.push(activity));

    projector.handle(event({ type: "agent_start" }));
    projector.handle(event({
      type: "message_update",
      message: assistantMessage(),
      assistantMessageEvent: { type: "thinking_delta", delta: "plan" }
    }));
    projector.handle(event({
      type: "message_update",
      message: assistantMessage(),
      assistantMessageEvent: { type: "text_delta", delta: "result" }
    }));
    projector.handle(event({ type: "compaction_start", reason: "threshold" }));
    projector.handle(event({
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: false,
      willRetry: true
    }));

    expect(activities).toEqual([
      null,
      { kind: "thinking" },
      { kind: "responding" },
      { kind: "compaction" },
      null
    ]);
  });

  it("tracks parallel tools and restores the latest still-active tool", () => {
    const activities: RuntimeOperationActivity[] = [];
    const projector = new OperationActivityProjector((activity) => activities.push(activity));

    projector.handle(event({
      type: "tool_execution_start",
      toolCallId: "read-1",
      toolName: "read",
      args: {}
    }), "read");
    projector.handle(event({
      type: "tool_execution_start",
      toolCallId: "shell-1",
      toolName: "bash",
      args: {}
    }), "shell");
    projector.handle(event({
      type: "tool_execution_end",
      toolCallId: "shell-1",
      toolName: "bash",
      result: {},
      isError: false
    }));
    projector.handle(event({
      type: "tool_execution_end",
      toolCallId: "read-1",
      toolName: "read",
      result: {},
      isError: false
    }));

    expect(activities).toEqual([
      { kind: "tool", toolCallId: "read-1", toolKind: "read" },
      { kind: "tool", toolCallId: "shell-1", toolKind: "shell" },
      { kind: "tool", toolCallId: "read-1", toolKind: "read" },
      null
    ]);
  });

  it("clears semantic activity when Pi is waiting, retrying, or fully settled", () => {
    const activities: RuntimeOperationActivity[] = [];
    const projector = new OperationActivityProjector((activity) => activities.push(activity));

    projector.handle(event({ type: "agent_start" }));
    projector.handle(event({ type: "turn_start" }));
    projector.handle(event({
      type: "message_update",
      message: assistantMessage(),
      assistantMessageEvent: { type: "thinking_start", contentIndex: 0, partial: assistantMessage() }
    }));
    projector.handle(event({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 10, errorMessage: "retry" }));
    projector.handle(event({ type: "agent_settled" }));
    projector.handle(event({ type: "agent_start" }));

    expect(activities).toEqual([null, { kind: "thinking" }, null, null]);
  });

  it("bounds active tool state and treats unknown Extension tools as generic", () => {
    const activities: RuntimeOperationActivity[] = [];
    const projector = new OperationActivityProjector((activity) => activities.push(activity));

    for (let index = 0; index < 65; index += 1) {
      projector.handle(event({
        type: "tool_execution_start",
        toolCallId: `tool-${index}`,
        toolName: index === 64 ? "extension:unknown" : "read",
        args: {}
      }), index === 64 ? "generic" : "read");
    }
    projector.handle(event({
      type: "tool_execution_end",
      toolCallId: "tool-64",
      toolName: "extension:unknown",
      result: {},
      isError: false
    }));

    expect(activities.at(-2)).toEqual({ kind: "tool", toolCallId: "tool-64", toolKind: "generic" });
    expect(activities.at(-1)).toEqual({ kind: "tool", toolCallId: "tool-63", toolKind: "read" });
  });
});

function event(value: object): AgentSessionEvent {
  return value as AgentSessionEvent;
}

function assistantMessage() {
  return { role: "assistant", content: [] };
}
