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
      { kind: "tool", toolCallId: "read-1", toolName: "read", toolKind: "read", status: "running" },
      { kind: "tool", toolCallId: "shell-1", toolName: "bash", toolKind: "shell", status: "running" },
      { kind: "tool", toolCallId: "shell-1", toolName: "bash", toolKind: "shell", status: "completed" },
      { kind: "tool", toolCallId: "read-1", toolName: "read", toolKind: "read", status: "running" },
      { kind: "tool", toolCallId: "read-1", toolName: "read", toolKind: "read", status: "completed" }
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

    expect(activities.at(-2)).toEqual({
      kind: "tool",
      toolCallId: "tool-64",
      toolName: "extension:unknown",
      toolKind: "generic",
      status: "completed"
    });
    expect(activities.at(-1)).toEqual({
      kind: "tool",
      toolCallId: "tool-63",
      toolName: "read",
      toolKind: "read",
      status: "running"
    });
  });

  it("preserves a bounded tool name, alias target, and real terminal outcome", () => {
    const activities: RuntimeOperationActivity[] = [];
    const projector = new OperationActivityProjector((activity) => activities.push(activity));

    projector.handle(event({
      type: "tool_execution_start",
      toolCallId: "alias-search",
      toolName: "WebSearch",
      args: { query: "杭州天气", workflow: "none" }
    }), "search");
    projector.handle(event({
      type: "tool_execution_end",
      toolCallId: "alias-search",
      toolName: "WebSearch",
      result: { content: [{ type: "text", text: "provider payload must not enter activity" }] },
      isError: true
    }));

    expect(activities).toEqual([
      {
        kind: "tool",
        toolCallId: "alias-search",
        toolName: "WebSearch",
        toolKind: "search",
        status: "running",
        aliasTarget: "web_search"
      },
      {
        kind: "tool",
        toolCallId: "alias-search",
        toolName: "WebSearch",
        toolKind: "search",
        status: "failed",
        aliasTarget: "web_search"
      }
    ]);
    expect(JSON.stringify(activities)).not.toContain("provider payload");
  });

  it("carries only the bounded AUTO authorization reason through the live Tool outcome", () => {
    const activities: RuntimeOperationActivity[] = [];
    const projector = new OperationActivityProjector((activity) => activities.push(activity));

    projector.handle(event({
      type: "tool_execution_start",
      toolCallId: "configured-tool",
      toolName: "subagent",
      args: { prompt: "must not enter activity" }
    }), "subagent", { mode: "auto", reason: "configured-source" });
    projector.handle(event({
      type: "tool_execution_end",
      toolCallId: "configured-tool",
      toolName: "subagent",
      result: { content: [{ type: "text", text: "must not enter activity" }] },
      isError: false
    }));

    expect(activities).toEqual([
      expect.objectContaining({
        kind: "tool",
        status: "running",
        authorization: { mode: "auto", reason: "configured-source" }
      }),
      expect.objectContaining({
        kind: "tool",
        status: "completed",
        authorization: { mode: "auto", reason: "configured-source" }
      })
    ]);
    expect(JSON.stringify(activities)).not.toContain("must not enter activity");
  });

  it("publishes an AUTO reason recorded after Pi starts the Tool and preserves it at completion", () => {
    const activities: RuntimeOperationActivity[] = [];
    const projector = new OperationActivityProjector((activity) => activities.push(activity));

    projector.handle(event({
      type: "tool_execution_start",
      toolCallId: "late-authorization",
      toolName: "grep",
      args: { query: "must not enter activity" }
    }), "search");
    projector.recordToolAuthorization("late-authorization", { mode: "auto", reason: "read-only" });
    projector.handle(event({
      type: "tool_execution_end",
      toolCallId: "late-authorization",
      toolName: "grep",
      result: { content: [{ type: "text", text: "must not enter activity" }] },
      isError: false
    }));

    expect(activities).toEqual([
      {
        kind: "tool",
        toolCallId: "late-authorization",
        toolName: "grep",
        toolKind: "search",
        status: "running"
      },
      expect.objectContaining({
        kind: "tool",
        status: "running",
        authorization: { mode: "auto", reason: "read-only" }
      }),
      expect.objectContaining({
        kind: "tool",
        status: "completed",
        authorization: { mode: "auto", reason: "read-only" }
      })
    ]);
    expect(JSON.stringify(activities)).not.toContain("must not enter activity");
  });

  it("uses the Tool-end authorization as a fallback when active state has no reason", () => {
    const activities: RuntimeOperationActivity[] = [];
    const projector = new OperationActivityProjector((activity) => activities.push(activity));

    projector.handle(event({
      type: "tool_execution_start",
      toolCallId: "end-fallback",
      toolName: "read",
      args: {}
    }), "read");
    projector.handle(event({
      type: "tool_execution_end",
      toolCallId: "end-fallback",
      toolName: "read",
      result: {},
      isError: false
    }), "generic", { mode: "auto", reason: "read-only" });

    expect(activities.at(-1)).toEqual({
      kind: "tool",
      toolCallId: "end-fallback",
      toolName: "read",
      toolKind: "read",
      status: "completed",
      authorization: { mode: "auto", reason: "read-only" }
    });
  });
});

function event(value: object): AgentSessionEvent {
  return value as AgentSessionEvent;
}

function assistantMessage() {
  return { role: "assistant", content: [] };
}
