import type { ImageContent } from "@earendil-works/pi-ai";
import type { MessagePart, SessionMessageView } from "@pi67/domain";
import type { TransferImage } from "@pi67/protocol";

export function convertTransferImages(images: TransferImage[]): ImageContent[] {
  return images.map((image) => ({
    type: "image",
    mimeType: image.mimeType,
    data: Buffer.from(image.data).toString("base64")
  }));
}

export function normalizeMessages(messages: readonly unknown[]): SessionMessageView[] {
  return messages.map((message, index) => normalizeMessage(message, index));
}

export function normalizeStreamDelta(value: unknown): {
  assistantMessageEvent: { type: "text_delta" | "thinking_delta"; delta: string };
} | undefined {
  const event = asRecord(value);
  const assistantEvent = asRecord(event.assistantMessageEvent);
  const type = assistantEvent.type;
  const delta = stringValue(assistantEvent.delta);
  if ((type !== "text_delta" && type !== "thinking_delta") || delta === undefined) return undefined;
  return { assistantMessageEvent: { type, delta } };
}

function normalizeMessage(value: unknown, index: number): SessionMessageView {
  const message = asRecord(value);
  const role = normalizeRole(message.role);
  const parts = normalizeContent(message.content, message);
  const id = stringValue(message.id) ?? stringValue(message.toolCallId) ?? `message-${index}`;
  const createdAt = numberValue(message.timestamp) ?? numberValue(message.createdAt);
  const model = stringValue(message.model);
  const error = stringValue(message.errorMessage) ?? (message.isError === true ? "Tool execution failed." : undefined);
  return {
    id,
    role,
    parts: parts.length > 0 ? parts : [{ type: "text", text: fallbackText(message) }],
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(model === undefined ? {} : { model }),
    ...(message.stopReason === "aborted" ? { stopped: true } : {}),
    ...(error === undefined ? {} : { error })
  };
}

function normalizeContent(content: unknown, message: Record<string, unknown>): MessagePart[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) {
    const toolName = stringValue(message.toolName);
    return toolName ? [{ type: "tool-call", id: stringValue(message.toolCallId) ?? toolName, name: toolName, status: message.isError ? "failed" : "completed" }] : [];
  }
  return content.flatMap((part, index) => normalizePart(part, index));
}

function normalizePart(value: unknown, index: number): MessagePart[] {
  const part = asRecord(value);
  const type = stringValue(part.type);
  if (type === "text") return [{ type: "text", text: stringValue(part.text) ?? "" }];
  if (type === "thinking") return [{ type: "thinking", text: stringValue(part.thinking) ?? stringValue(part.text) ?? "" }];
  if (type === "toolCall" || type === "tool-call") {
    return [{
      type: "tool-call",
      id: stringValue(part.id) ?? `tool-${index}`,
      name: stringValue(part.name) ?? "tool",
      status: "completed",
      ...(part.arguments === undefined ? {} : { summary: compactJson(part.arguments) })
    }];
  }
  if (type === "image") {
    const mimeType = stringValue(part.mimeType) ?? "image/png";
    const data = stringValue(part.data);
    return [{ type: "image", mimeType, ...(data ? { dataUrl: `data:${mimeType};base64,${data}` } : {}) }];
  }
  const text = stringValue(part.text);
  return text ? [{ type: "text", text }] : [];
}

function normalizeRole(value: unknown): SessionMessageView["role"] {
  if (value === "user" || value === "assistant" || value === "system") return value;
  return "tool";
}

function fallbackText(message: Record<string, unknown>): string {
  const toolName = stringValue(message.toolName);
  if (toolName) return `${toolName} tool result`;
  return compactJson(message);
}

function compactJson(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 2_000 ? `${text.slice(0, 2_000)}...` : text;
  } catch {
    return "Unsupported message content";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
