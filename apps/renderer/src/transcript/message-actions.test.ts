import type { SessionMessageView } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  editableUserMessageText,
  messageTextForCopy,
  userMessageContainsImage
} from "./message-actions.js";

describe("transcript message actions", () => {
  it("copies only final text and excludes thinking, images, and Tool payloads", () => {
    const message: SessionMessageView = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "thinking", text: "private reasoning" },
        { type: "text", text: "First paragraph." },
        { type: "tool-call", id: "tool-1", name: "bash", status: "completed", summary: "secret raw payload" },
        { type: "image", mimeType: "image/png", name: "result.png" },
        { type: "text", text: "Second paragraph." }
      ]
    };

    expect(messageTextForCopy(message)).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("allows text-only user messages to be edited without mutating their source", () => {
    const message: SessionMessageView = {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "  Keep this prompt.  " }]
    };

    expect(editableUserMessageText(message)).toBe("Keep this prompt.");
    expect(userMessageContainsImage(message)).toBe(false);
    expect(message.parts[0]).toEqual({ type: "text", text: "  Keep this prompt.  " });
  });

  it("does not offer lossy editing for user messages with images", () => {
    const message: SessionMessageView = {
      id: "user-image-1",
      role: "user",
      parts: [
        { type: "text", text: "Describe this." },
        { type: "image", mimeType: "image/png", name: "input.png" }
      ]
    };

    expect(messageTextForCopy(message)).toBe("Describe this.");
    expect(editableUserMessageText(message)).toBeUndefined();
    expect(userMessageContainsImage(message)).toBe(true);
  });
});
