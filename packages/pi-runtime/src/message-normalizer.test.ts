import { describe, expect, it } from "vitest";
import { normalizeStreamDelta } from "./message-normalizer.js";

describe("normalizeStreamDelta", () => {
  it("projects only visible text and thinking deltas", () => {
    expect(normalizeStreamDelta({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "hello",
        rawToolPayload: { secret: "must-not-cross-the-port" }
      }
    })).toEqual({ assistantMessageEvent: { type: "text_delta", delta: "hello" } });

    expect(normalizeStreamDelta({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "reasoning" }
    })).toEqual({ assistantMessageEvent: { type: "thinking_delta", delta: "reasoning" } });
  });

  it("drops non-rendered message updates", () => {
    expect(normalizeStreamDelta({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_delta", delta: "raw tool data" }
    })).toBeUndefined();
  });
});
