import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { DurableToolExecutionIndex } from "./durable-tool-execution-index.js";

describe("DurableToolExecutionIndex", () => {
  it("reconciles a Tool Call with the real Tool Result and receipt timing", () => {
    const index = new DurableToolExecutionIndex("/workspace");
    index.rebuild([
      assistantCall("tool-1", "bash", { command: "pnpm test" }),
      receipt("tool-1", "bash", "failed", 10, 35),
      toolResult("tool-1", "bash", true, "exit code 1")
    ]);

    expect(index.get("tool-1")).toMatchObject({
      toolCallId: "tool-1",
      toolName: "bash",
      toolKind: "shell",
      status: "failed",
      projectionSource: "durable",
      command: { text: "pnpm test" },
      cwd: "/workspace",
      resultState: "present",
      startedAt: 10,
      completedAt: 35,
      durationMs: 25,
      timingSource: "receipt",
      failure: { detailState: "available", message: { text: "exit code 1" } }
    });
  });

  it("marks a receipt without a durable Tool Result as unreconciled", () => {
    const index = new DurableToolExecutionIndex();
    index.rebuild([
      assistantCall("tool-1", "read", { path: "README.md" }),
      receipt("tool-1", "read", "completed", 10, 20)
    ]);

    expect(index.get("tool-1")).toMatchObject({
      status: "unreconciled",
      resultState: "unreconciled",
      startedAt: 10,
      completedAt: 20,
      durationMs: 10
    });
  });

  it("lets the Pi Tool Result override a conflicting receipt status", () => {
    const index = new DurableToolExecutionIndex();
    index.rebuild([
      assistantCall("tool-1", "read", {}),
      toolResult("tool-1", "read", false, "ok"),
      receipt("tool-1", "read", "failed", 10, 20)
    ]);

    expect(index.get("tool-1")).toMatchObject({
      status: "completed",
      resultState: "present",
      timingSource: "receipt"
    });
  });

  it("does not create a card from an orphan receipt", () => {
    const index = new DurableToolExecutionIndex();
    index.rebuild([receipt("orphan", "bash", "completed", 1, 2)]);

    expect(index.get("orphan")).toBeUndefined();
  });

  it("rebuilds nested Pi JSONL summaries without inventing child results", () => {
    const index = new DurableToolExecutionIndex("/workspace");
    index.rebuild([
      assistantCall("codemode-1", "codemode", { code: "await tools.read({ path: 'README.md' })" }),
      entry({
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "codemode-1",
          toolName: "codemode",
          isError: false,
          content: [{ type: "text", text: "done" }],
          nestedCalls: {
            complete: true,
            calls: [{
              id: "codemode-1/1",
              name: "read",
              arguments: { path: "README.md", token: "private" },
              status: "ok",
              durationMs: 7
            }, {
              id: "codemode-1/2",
              name: "write",
              argumentsBytes: 12_000,
              status: "error",
              durationMs: 9,
              error: "blocked by policy; Authorization: Bearer private-nested-credential"
            }]
          }
        }
      })
    ]);

    expect(index.get("codemode-1")).toMatchObject({ nestedRecord: { complete: true } });
    expect(index.get("codemode-1/1")).toMatchObject({
      toolCallId: "codemode-1/1",
      parentToolCallId: "codemode-1",
      toolName: "read",
      status: "completed",
      resultState: "present",
      durationMs: 7,
      timingSource: "pi-result",
      inputSummary: { text: expect.stringContaining("README.md") }
    });
    expect(JSON.stringify(index.get("codemode-1/1"))).not.toContain("private");
    expect(index.get("codemode-1/2")).toMatchObject({
      parentToolCallId: "codemode-1",
      status: "failed",
      resultState: "present",
      durationMs: 9,
      failure: { detailState: "available", message: { text: expect.stringContaining("blocked by policy") } }
    });
    expect(JSON.stringify(index.get("codemode-1/2"))).not.toContain("private-nested-credential");
    expect(index.getNestedTools("codemode-1")).toMatchObject({
      complete: true,
      calls: [
        { toolCallId: "codemode-1/1", parentToolCallId: "codemode-1" },
        { toolCallId: "codemode-1/2", parentToolCallId: "codemode-1" }
      ]
    });
  });

  it("rejects malformed nested records and does not make child cards from receipts", () => {
    const index = new DurableToolExecutionIndex();
    index.rebuild([
      assistantCall("codemode-1", "codemode", {}),
      entry({
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "codemode-1",
          toolName: "codemode",
          isError: false,
          content: [{ type: "text", text: "done" }],
          nestedCalls: {
            complete: true,
            calls: [{ id: "codemode-1/1", name: "read", status: "cancelled" }]
          }
        }
      }),
      receipt("codemode-1/1", "read", "completed", 1, 2)
    ]);
    expect(index.get("codemode-1/1")).toBeUndefined();
    expect(index.get("codemode-1")).toMatchObject({ nestedRecord: { complete: false } });
    expect(index.getNestedTools("codemode-1")).toEqual({ calls: [], complete: false });
  });

  it("does not expose nested children when Pi has no native root result", () => {
    const index = new DurableToolExecutionIndex();
    index.rebuild([
      assistantCall("codemode-1", "codemode", {}),
      receipt("codemode-1/1", "read", "completed", 1, 2)
    ]);

    expect(index.getNestedTools("codemode-1")).toBeUndefined();
    expect(index.get("codemode-1/1")).toBeUndefined();
  });

  it("fails closed when a nested child collides with an existing root Tool Call", () => {
    const index = new DurableToolExecutionIndex();
    index.rebuild([
      assistantCall("codemode-1", "codemode", {}),
      assistantCall("codemode-1/1", "read", { path: "README.md" }),
      entry({
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "codemode-1",
          toolName: "codemode",
          isError: false,
          content: [{ type: "text", text: "done" }],
          nestedCalls: {
            complete: true,
            calls: [{ id: "codemode-1/1", name: "read", status: "ok" }]
          }
        }
      })
    ]);

    expect(index.get("codemode-1")).toMatchObject({ nestedRecord: { complete: false } });
    expect(index.getNestedTools("codemode-1")).toEqual({ calls: [], complete: false });
    expect(index.get("codemode-1/1")).toMatchObject({ resultState: "unreconciled" });
    expect(index.get("codemode-1/1")).not.toHaveProperty("parentToolCallId");
  });
});

function assistantCall(toolCallId: string, toolName: string, args: unknown): SessionEntry {
  return entry({
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: toolCallId, name: toolName, arguments: args }]
    }
  });
}

function toolResult(
  toolCallId: string,
  toolName: string,
  isError: boolean,
  text: string
): SessionEntry {
  return entry({
    type: "message",
    message: {
      role: "toolResult",
      toolCallId,
      toolName,
      isError,
      content: [{ type: "text", text }]
    }
  });
}

function receipt(
  toolCallId: string,
  toolName: string,
  status: "completed" | "failed",
  startedAt: number,
  completedAt: number
): SessionEntry {
  return entry({
    type: "custom",
    customType: "pi67.tool-executions.v1",
    data: { items: [{ toolCallId, toolName, status, startedAt, completedAt }] }
  });
}

function entry(value: object): SessionEntry {
  return value as SessionEntry;
}
