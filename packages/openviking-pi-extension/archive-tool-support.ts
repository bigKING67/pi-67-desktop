import type { OVSessionArchive } from "./client.js";
import { truncateText } from "./tool-result.js";

const ARCHIVE_ID = /^archive_[0-9]{3,10}$/u;
const MAX_MESSAGES = 50;
const MAX_FIELD_CHARS = 2_000;

export function isArchiveId(value: unknown): value is string {
  return typeof value === "string" && ARCHIVE_ID.test(value);
}

export function renderArchive(
  archive: OVSessionArchive,
  maxChars: number,
): { text: string; truncated: boolean; messageCount: number } {
  const messages = Array.isArray(archive.messages) ? archive.messages : [];
  const boundedMessages = messages.slice(0, MAX_MESSAGES);
  const body = JSON.stringify({
    archive_id: archive.archive_id,
    abstract: archive.abstract ?? "",
    overview: archive.overview ?? "",
    messages: boundedMessages,
    omitted_messages: Math.max(0, messages.length - boundedMessages.length),
  }, (_key, value) => typeof value === "string" && value.length > MAX_FIELD_CHARS
    ? `${value.slice(0, MAX_FIELD_CHARS)} [field truncated]`
    : value, 2);
  const bounded = truncateText(body, maxChars);
  return { ...bounded, messageCount: messages.length };
}
