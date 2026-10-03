import { MAX_PROJECTED_MESSAGE_PARTS } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { normalizeMessages } from "./message-normalizer.js";

describe("native nested tool message projection", () => {
  it("projects native nested calls onto the root card without a live execution resolver", () => {
    const messages = normalizeMessages([
      { role: "assistant", content: [{ type: "toolCall", id: "codemode-1", name: "codemode", arguments: { code: "..." } }] },
      {
        role: "toolResult", toolCallId: "codemode-1", toolName: "codemode", content: [{ type: "text", text: "done" }], isError: false,
        nestedCalls: {
          complete: true,
          calls: [
            { id: "codemode-1/1", name: "read", arguments: { path: "README.md", token: "private" }, status: "ok", durationMs: 4 },
            { id: "codemode-1/2", name: "write", argumentsBytes: 9_000, status: "error", durationMs: 5, error: "blocked" }
          ]
        }
      }
    ]);

    const parts = messages[0]?.parts;
    expect(parts).toHaveLength(3);
    expect(parts?.[0]).toMatchObject({ type: "tool-call", id: "codemode-1", execution: { nestedRecord: { complete: true } } });
    expect(parts?.[1]).toMatchObject({
      type: "tool-call", id: "codemode-1/1", name: "read", status: "completed",
      execution: { parentToolCallId: "codemode-1", timingSource: "pi-result" }
    });
    expect(parts?.[2]).toMatchObject({
      type: "tool-call", id: "codemode-1/2", status: "failed",
      execution: { parentToolCallId: "codemode-1", failure: { message: { text: "blocked" } } }
    });
    expect(JSON.stringify(parts)).not.toContain("private");
  });

  it("bounds nested cards and marks the root record incomplete when projection omits children", () => {
    const calls = Array.from({ length: MAX_PROJECTED_MESSAGE_PARTS + 1 }, (_, index) => ({ id: `codemode-1/${index + 1}`, name: "read", status: "ok" }));
    const messages = normalizeMessages([
      { role: "assistant", content: [{ type: "toolCall", id: "codemode-1", name: "codemode", arguments: {} }] },
      { role: "toolResult", toolCallId: "codemode-1", toolName: "codemode", content: [{ type: "text", text: "done" }], isError: false, nestedCalls: { complete: true, calls } }
    ]);

    expect(messages[0]?.parts).toHaveLength(MAX_PROJECTED_MESSAGE_PARTS);
    expect(messages[0]?.parts[0]).toMatchObject({ type: "tool-call", execution: { nestedRecord: { complete: false } } });
  });

  it("reserves bounded transcript capacity for original parts after a nested root", () => {
    const calls = Array.from({ length: MAX_PROJECTED_MESSAGE_PARTS }, (_, index) => ({ id: `codemode-1/${index + 1}`, name: "read", status: "ok" }));
    const messages = normalizeMessages([
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "codemode-1", name: "codemode", arguments: {} },
          { type: "text", text: "after nested calls" },
          { type: "toolCall", id: "later-tool", name: "read", arguments: { path: "later.md" } }
        ]
      },
      { role: "toolResult", toolCallId: "codemode-1", toolName: "codemode", content: [{ type: "text", text: "done" }], isError: false, nestedCalls: { complete: true, calls } }
    ]);

    const parts = messages[0]?.parts ?? [];
    expect(parts).toHaveLength(MAX_PROJECTED_MESSAGE_PARTS);
    expect(parts.some((part) => part.type === "text" && part.text === "after nested calls")).toBe(true);
    expect(parts.some((part) => part.type === "tool-call" && part.id === "later-tool")).toBe(true);
    expect(parts[0]).toMatchObject({ type: "tool-call", execution: { nestedRecord: { complete: false } } });
  });

  it("fails closed when a native child ID collides with an assistant Tool Call", () => {
    const messages = normalizeMessages([
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "codemode-1", name: "codemode", arguments: {} },
          { type: "toolCall", id: "codemode-1/1", name: "read", arguments: {} }
        ]
      },
      { role: "toolResult", toolCallId: "codemode-1", toolName: "codemode", content: [{ type: "text", text: "done" }], isError: false, nestedCalls: { complete: true, calls: [{ id: "codemode-1/1", name: "read", status: "ok" }] } }
    ]);

    expect(messages[0]?.parts).toHaveLength(2);
    expect(messages[0]?.parts[0]).toMatchObject({ type: "tool-call", execution: { nestedRecord: { complete: false } } });
  });
});
