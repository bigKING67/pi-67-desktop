import { describe, expect, it } from "vitest";
import { parseToolExecutionReceipt } from "./tool-execution-receipt.js";

describe("tool execution receipt", () => {
  it("accepts the bounded versioned receipt data", () => {
    expect(parseToolExecutionReceipt({
      items: [{
        toolCallId: "tool-1",
        toolName: "bash",
        startedAt: 10,
        completedAt: 25,
        status: "failed"
      }],
      omittedCount: 2
    })).toEqual({
      items: [{
        toolCallId: "tool-1",
        toolName: "bash",
        startedAt: 10,
        completedAt: 25,
        status: "failed"
      }],
      omittedCount: 2
    });
  });

  it.each([
    { items: [] },
    { items: [{ toolCallId: "tool-1", toolName: "bash", completedAt: 9, startedAt: 10, status: "completed" }] },
    { items: [{ toolCallId: "tool-1", toolName: "bash", completedAt: 10, status: "lost" }] },
    { items: [{ toolCallId: "tool-1", toolName: "bash", completedAt: 10, status: "completed", extra: true }] },
    { items: [
      { toolCallId: "tool-1", toolName: "bash", completedAt: 10, status: "completed" },
      { toolCallId: "tool-1", toolName: "bash", completedAt: 11, status: "completed" }
    ] },
    { items: [{ toolCallId: "tool-1\n", toolName: "bash", completedAt: 10, status: "completed" }] },
    { items: [{ toolCallId: "tool-1", toolName: "bash", completedAt: 10, status: "completed" }], extra: true }
  ])("rejects malformed or ambiguous receipt data", (value) => {
    expect(parseToolExecutionReceipt(value)).toBeUndefined();
  });
});
