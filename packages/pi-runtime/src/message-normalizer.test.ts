import { describe, expect, it } from "vitest";
import {
  MAX_PROJECTED_MESSAGE_PARTS,
  MAX_PROJECTED_TEXT_BYTES
} from "@pi67/domain";
import {
  normalizeMessages,
  normalizeMessagesWithAdapters,
  normalizeStreamDelta
} from "./message-normalizer.js";

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

  it("never serializes unknown raw messages into the renderer projection", () => {
    const [message] = normalizeMessages([{
      role: "future-role",
      internalPayload: { apiKey: "sk-private-value", prompt: "private prompt" }
    }]);

    expect(message?.parts).toEqual([{ type: "text", text: "Unsupported message content" }]);
    expect(JSON.stringify(message)).not.toContain("private-value");
    expect(JSON.stringify(message)).not.toContain("private prompt");
  });

  it("bounds tool argument summaries and redacts common secret shapes", () => {
    const circular: Record<string, unknown> = { command: "curl https://user:password@example.test" };
    circular.self = circular;
    const [message] = normalizeMessages([{
      role: "assistant",
      content: [{
        type: "toolCall",
        id: "tool-1",
        name: "bash",
        arguments: {
          command: "curl -H 'Authorization: Bearer abcdefghijklmnop' https://example.test",
          apiKey: "sk-abcdefghijklmnop",
          jwt: "abcdefghijk.abcdefghijkl.mnopqrstuvw",
          circular,
          oversized: "x".repeat(5_000)
        }
      }]
    }]);

    const summary = message?.parts[0]?.type === "tool-call" ? message.parts[0].summary : undefined;
    expect(summary).toContain("[redacted]");
    expect(summary).toContain("[circular]");
    expect(summary).not.toContain("abcdefghijklmnop");
    expect(summary).not.toContain("password@example");
    expect(summary?.length).toBeLessThanOrEqual(2_000);
  });

  it("bounds transcript text and message part counts without inlining image data", () => {
    const privateImageData = "PRIVATE_IMAGE_DATA";
    const [message] = normalizeMessages([{
      role: "assistant",
      content: [
        { type: "text", text: "中".repeat(MAX_PROJECTED_TEXT_BYTES) },
        { type: "image", mimeType: "image/png", data: privateImageData },
        ...Array.from({ length: MAX_PROJECTED_MESSAGE_PARTS + 10 }, () => ({ type: "text", text: "extra" }))
      ]
    }]);

    expect(message?.parts).toHaveLength(MAX_PROJECTED_MESSAGE_PARTS);
    const text = message?.parts[0]?.type === "text" ? message.parts[0].text : "";
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(MAX_PROJECTED_TEXT_BYTES);
    expect(text).toContain("桌面投影已截断");
    expect(message?.parts[1]).toEqual({ type: "image", mimeType: "image/png" });
    expect(JSON.stringify(message)).not.toContain(privateImageData);
    expect(message?.parts[1]).not.toHaveProperty("dataUrl");
  });

  it("projects image content through a generation-bound asset reference", () => {
    const base64 = Buffer.from([1, 2, 3]).toString("base64");
    const sources: unknown[] = [];
    const [message] = normalizeMessagesWithAdapters([{
      role: "user",
      content: [{ type: "image", mimeType: "image/png", data: base64, name: "pixel.png" }]
    }], ["entry-1"], undefined, (source) => {
      sources.push(source);
      return { id: "asset-1", byteLength: 3, sessionGeneration: 4 };
    });

    expect(sources).toEqual([{
      stableKey: "entry-1:image:0",
      mimeType: "image/png",
      base64
    }]);
    expect(message?.parts).toEqual([{
      type: "image",
      mimeType: "image/png",
      asset: { id: "asset-1", byteLength: 3, sessionGeneration: 4 },
      name: "pixel.png"
    }]);
    expect(JSON.stringify(message)).not.toContain(base64);
  });

  it("does not project write or edit source bodies into transcript summaries", () => {
    const marker = "PRIVATE_SOURCE_MARKER";
    const messages = normalizeMessages([{
      role: "assistant",
      content: [
        { type: "toolCall", id: "write-1", name: "write", arguments: { path: "src/new.ts", content: marker } },
        { type: "toolCall", id: "edit-1", name: "edit", arguments: { path: "src/old.ts", edits: [{ oldText: marker, newText: marker }] } }
      ]
    }]);
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain(marker);
    expect(serialized).toContain("src/new.ts");
    expect(serialized).toContain("[omitted:21 chars]");
    const editPart = messages[0]?.parts.find((part) => part.type === "tool-call" && part.name === "edit");
    expect(editPart?.type === "tool-call" ? editPart.summary : undefined).toContain('"editCount":1');
  });

  it("attaches only explicit toolCallId-bound Adapter metadata", () => {
    const adapter = {
      adapterId: "verified-reader",
      package: "@verified/reader",
      presentation: "read" as const,
      label: "读取制品"
    };
    const messages = normalizeMessagesWithAdapters([{
      role: "assistant",
      content: [
        { type: "toolCall", id: "bound-call", name: "inspect", arguments: {} },
        { type: "toolCall", id: "unbound-call", name: "inspect", arguments: {} }
      ]
    }], [], (toolCallId) => toolCallId === "bound-call" ? adapter : undefined);

    expect(messages[0]?.parts[0]).toMatchObject({ type: "tool-call", id: "bound-call", adapter });
    expect(messages[0]?.parts[1]).toMatchObject({ type: "tool-call", id: "unbound-call" });
    expect(messages[0]?.parts[1]).not.toHaveProperty("adapter");
  });
});
