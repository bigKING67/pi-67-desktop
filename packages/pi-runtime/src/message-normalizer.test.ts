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

    expect(message?.parts).toEqual([{ type: "text", text: "当前版本无法显示此消息。" }]);
    expect(JSON.stringify(message)).not.toContain("private-value");
    expect(JSON.stringify(message)).not.toContain("private prompt");
  });

  it("turns a zero-token empty Assistant response into an observable retry state", () => {
    const [message] = normalizeMessages([{
      role: "assistant",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      stopReason: "stop",
      content: [],
      usage: { input: 0, output: 0, totalTokens: 0 }
    }]);

    expect(message).toMatchObject({
      role: "assistant",
      model: "claude-sonnet-4-5",
      parts: [],
      error: "模型未返回内容，请重试；若持续出现，请切换模型或检查模型服务配置。"
    });
    expect(JSON.stringify(message)).not.toContain("Unsupported message content");
  });

  it("retains a bounded Tool identity for result presentation", () => {
    const [message] = normalizeMessages([{
      role: "toolResult",
      toolCallId: "search-call",
      toolName: `web_search${"x".repeat(200)}`,
      content: [{ type: "text", text: "result" }],
      isError: false
    }]);

    expect(message?.role).toBe("tool");
    expect(message?.toolName).toHaveLength(128);
    expect(message?.toolName).toMatch(/^web_search/u);
  });

  it("drops encrypted or unavailable reasoning blocks that have no visible text", () => {
    const [message] = normalizeMessages([{
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", thinkingSignature: "opaque-provider-signature" },
        { type: "text", text: "可见回答" }
      ]
    }]);

    expect(message?.parts).toEqual([{ type: "text", text: "可见回答" }]);
    expect(JSON.stringify(message)).not.toContain("opaque-provider-signature");
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

describe("normalizeMessages tool outcome correlation", () => {
  it("marks an assistant Tool Call failed when its Tool Result failed in the same page", () => {
    const messages = normalizeMessages([
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "agent-call", name: "Agent", arguments: {} }]
      },
      {
        role: "toolResult",
        toolCallId: "agent-call",
        toolName: "Agent",
        content: [{ type: "text", text: "Tool Agent not found" }],
        isError: true
      }
    ]);

    expect(messages[0]?.parts[0]).toMatchObject({
      type: "tool-call",
      id: "agent-call",
      status: "failed"
    });
  });

  it("keeps successful correlated Tool Calls completed", () => {
    const messages = normalizeMessages([
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "search-call", name: "web_search", arguments: {} }]
      },
      {
        role: "toolResult",
        toolCallId: "search-call",
        toolName: "web_search",
        content: [{ type: "text", text: "done" }],
        isError: false
      }
    ]);

    expect(messages[0]?.parts[0]).toMatchObject({ status: "completed" });
  });

  it("prefers the full-branch Tool execution projection over page-local inference", () => {
    const execution = {
      toolCallId: "search-call",
      toolName: "web_search",
      toolKind: "search" as const,
      status: "failed" as const,
      projectionSource: "durable" as const,
      resultState: "present" as const,
      failure: {
        detailState: "available" as const,
        source: "pi-result" as const,
        message: { text: "provider unavailable", truncated: false }
      }
    };
    const messages = normalizeMessagesWithAdapters([{
      role: "assistant",
      content: [{ type: "toolCall", id: "search-call", name: "web_search", arguments: {} }]
    }], [], undefined, undefined, (toolCallId) => toolCallId === "search-call" ? execution : undefined);

    expect(messages[0]?.parts[0]).toMatchObject({
      type: "tool-call",
      status: "failed",
      execution
    });
  });
});

describe("normalizeMessages Desktop prompt attachments", () => {
  it("hides attachment control messages and merges only bounded metadata into the next user turn", () => {
    const base64 = Buffer.from([1, 2, 3]).toString("base64");
    const messages = normalizeMessagesWithAdapters([
      attachmentControlMessage([
        {
          id: "image_a",
          name: "diagram.png",
          mimeType: "image/png",
          byteLength: 3,
          kind: "image",
          path: "/private/staging/diagram.png"
        },
        {
          id: "document_a",
          name: "brief.txt",
          mimeType: "text/plain",
          byteLength: 24,
          kind: "document",
          sourceBody: "PRIVATE_SOURCE_BODY",
          rawBytes: "PRIVATE_RAW_BYTES"
        }
      ]),
      {
        role: "user",
        content: [
          { type: "text", text: "Summarize the attachments" },
          { type: "image", mimeType: "image/png", data: base64 }
        ]
      }
    ], ["attachment-control", "user-entry"], undefined, () => ({
      id: "asset_a",
      byteLength: 3,
      sessionGeneration: 2
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.parts).toEqual([
      { type: "text", text: "Summarize the attachments" },
      {
        type: "image",
        mimeType: "image/png",
        asset: { id: "asset_a", byteLength: 3, sessionGeneration: 2 },
        name: "diagram.png"
      },
      {
        type: "attachment",
        id: "document_a",
        name: "brief.txt",
        mimeType: "text/plain",
        byteLength: 24,
        kind: "document"
      }
    ]);
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain("/private/staging");
    expect(serialized).not.toContain("PRIVATE_SOURCE_BODY");
    expect(serialized).not.toContain("PRIVATE_RAW_BYTES");
    expect(serialized).not.toContain(base64);
  });

  it("does not carry attachment metadata across an intervening non-user message", () => {
    const messages = normalizeMessages([
      attachmentControlMessage([{
        id: "document_a",
        name: "brief.txt",
        mimeType: "text/plain",
        byteLength: 24,
        kind: "document"
      }]),
      { role: "assistant", content: [{ type: "text", text: "Earlier answer" }] },
      { role: "user", content: [{ type: "text", text: "Unrelated turn" }] }
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "Unrelated turn" }]);
  });

  it("drops malformed hidden attachment messages without exposing or reusing their payload", () => {
    const messages = normalizeMessages([
      attachmentControlMessage([{
        id: "document_a",
        name: "brief.txt",
        mimeType: "text/plain",
        byteLength: 24,
        kind: "document"
      }]),
      {
        role: "custom",
        customType: "pi67.desktop-attachments.v1",
        display: false,
        content: "PRIVATE_CONTROL_CONTENT",
        details: {
          attachments: [{
            id: "../invalid",
            name: "/private/staging/secret.txt",
            mimeType: "text/plain",
            byteLength: 10,
            kind: "document"
          }]
        }
      },
      { role: "user", content: [{ type: "text", text: "Next turn" }] }
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts).toEqual([{ type: "text", text: "Next turn" }]);
    expect(JSON.stringify(messages)).not.toContain("PRIVATE_CONTROL_CONTENT");
    expect(JSON.stringify(messages)).not.toContain("/private/staging");
  });
});

function attachmentControlMessage(attachments: unknown[]): Record<string, unknown> {
  return {
    role: "custom",
    customType: "pi67.desktop-attachments.v1",
    display: false,
    content: "Use read_attachment to inspect the attached files.",
    details: { id: "attachment_set_a", attachments }
  };
}
