import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  MAX_MESSAGE_SEARCH_SNIPPET_CHARS,
  MAX_USER_MESSAGE_PREVIEW_CHARS,
  type MessageSearchItem,
  type UserMessageIndexItem
} from "@pi67/domain";
import { sanitizeRuntimeText } from "./runtime-redaction.js";

export function searchProjectedMessages(
  branch: readonly SessionEntry[],
  query: string,
  limit: number
): { total: number; items: MessageSearchItem[] } {
  const needle = query.toLocaleLowerCase();
  const items: MessageSearchItem[] = [];
  let total = 0;
  for (const entry of branch) {
    const searchable = searchableMessage(entry);
    if (!searchable) continue;
    const matchIndex = searchable.text.toLocaleLowerCase().indexOf(needle);
    if (matchIndex < 0) continue;
    total += 1;
    if (items.length >= limit) continue;
    items.push({
      id: entry.id,
      role: searchable.role,
      snippet: messageSearchSnippet(searchable.text, matchIndex, query.length),
      ...(searchable.createdAt === undefined ? {} : { createdAt: searchable.createdAt })
    });
  }
  return { total, items };
}

export function projectUserMessageIndexItem(
  entry: Extract<SessionEntry, { type: "message" }>,
  ordinal: number,
  previous: SessionEntry | undefined
): UserMessageIndexItem {
  if (entry.message.role !== "user") throw new Error("Only user messages can be projected into the user index.");
  return projectUserMessageIndexItemValue(entry, ordinal, previous);
}

function searchableMessage(entry: SessionEntry): {
  role: "user" | "assistant";
  text: string;
  createdAt?: number;
} | undefined {
  if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) {
    return undefined;
  }
  const message = entry.message as unknown as { content?: unknown; timestamp?: unknown };
  const text = sanitizeRuntimeText(messageTextContent(message.content)).replace(/\s+/gu, " ").trim();
  if (!text) return undefined;
  const timestamp = typeof message.timestamp === "number"
    ? message.timestamp
    : Date.parse(entry.timestamp);
  return {
    role: entry.message.role,
    text,
    ...(Number.isFinite(timestamp) ? { createdAt: Math.max(0, Math.trunc(timestamp)) } : {})
  };
}

function messageTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (typeof part !== "object" || part === null) return [];
    const record = part as { type?: unknown; text?: unknown };
    return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
  }).join(" ");
}

function messageSearchSnippet(text: string, matchIndex: number, queryLength: number): string {
  const start = Math.max(0, matchIndex - Math.floor(MAX_MESSAGE_SEARCH_SNIPPET_CHARS * 0.35));
  let end = Math.min(text.length, Math.max(matchIndex + queryLength, start + 1));
  if (end - start < MAX_MESSAGE_SEARCH_SNIPPET_CHARS) {
    end = Math.min(text.length, start + MAX_MESSAGE_SEARCH_SNIPPET_CHARS);
  }
  const prefix = start > 0;
  const suffix = end < text.length;
  const budget = MAX_MESSAGE_SEARCH_SNIPPET_CHARS - Number(prefix) - Number(suffix);
  const value = Array.from(text.slice(start, end)).slice(0, budget).join("");
  if (start + value.length < end) end = start + value.length;
  return `${prefix ? "…" : ""}${value}${end < text.length ? "…" : ""}`;
}

function projectUserMessageIndexItemValue(
  entry: Extract<SessionEntry, { type: "message" }>,
  ordinal: number,
  previous: SessionEntry | undefined
): UserMessageIndexItem {
  const message = entry.message as unknown as { content?: unknown; timestamp?: unknown };
  const content = message.content;
  const text = messageTextContent(content);
  const fallbackImageCount = Array.isArray(content)
    ? content.filter((part) => (
        typeof part === "object" && part !== null && (part as { type?: unknown }).type === "image"
      )).length
    : 0;
  const attachmentCounts = promptAttachmentCounts(previous);
  const timestamp = typeof message.timestamp === "number"
    ? message.timestamp
    : Date.parse(entry.timestamp);
  return {
    id: entry.id,
    ordinal,
    preview: boundedPreview(text),
    ...(Number.isFinite(timestamp) ? { createdAt: Math.max(0, Math.trunc(timestamp)) } : {}),
    imageCount: attachmentCounts?.images ?? fallbackImageCount,
    attachmentCount: attachmentCounts?.attachments ?? 0
  };
}

function promptAttachmentCounts(
  entry: SessionEntry | undefined
): { images: number; attachments: number } | undefined {
  if (
    entry?.type !== "custom_message"
    || entry.customType !== "pi67.desktop-attachments.v1"
    || entry.display
    || typeof entry.details !== "object"
    || entry.details === null
  ) return undefined;
  const attachments = (entry.details as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return undefined;
  let images = 0;
  let nonImages = 0;
  for (const item of attachments.slice(0, 20)) {
    if (typeof item !== "object" || item === null) continue;
    if ((item as { kind?: unknown }).kind === "image") images += 1;
    else nonImages += 1;
  }
  return { images, attachments: nonImages };
}

function boundedPreview(value: string): string {
  const normalized = sanitizeRuntimeText(value).replace(/\s+/gu, " ").trim();
  const codePoints = Array.from(normalized);
  if (codePoints.length <= MAX_USER_MESSAGE_PREVIEW_CHARS) return normalized;
  return `${codePoints.slice(0, MAX_USER_MESSAGE_PREVIEW_CHARS - 1).join("")}…`;
}
