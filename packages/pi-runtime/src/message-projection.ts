import {
  sessionEntryToContextMessages,
  type SessionEntry,
  type SessionManager
} from "@earendil-works/pi-coding-agent";
import {
  MAX_CONVERSATION_PAGE_JSON_BYTES,
  type ConversationPage,
  type ExtensionToolAdapterView
} from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import {
  normalizeMessagesWithAdapters,
  type ImageAssetProjector
} from "./message-normalizer.js";

export const DEFAULT_MESSAGE_PAGE_SIZE = 100;
export const MAX_MESSAGE_PAGE_SIZE = 200;

export interface MessagePageOptions {
  direction?: "older" | "newer";
  cursor?: string;
  limit?: number;
}

type MessageSessionManager = Pick<SessionManager, "getBranch" | "getSessionId"> & {
  findBranchEntryIndex?(id: string): number | undefined;
};

export function projectMessagePage(
  sessionManager: MessageSessionManager,
  options: MessagePageOptions = {},
  resolveToolAdapter?: (toolCallId: string) => ExtensionToolAdapterView | undefined,
  projectImageAsset?: ImageAssetProjector
): ConversationPage {
  const entries = sessionManager.getBranch();
  const direction = options.direction ?? "older";
  const limit = Math.min(MAX_MESSAGE_PAGE_SIZE, Math.max(1, options.limit ?? DEFAULT_MESSAGE_PAGE_SIZE));
  const locatedCursorIndex = options.cursor === undefined
    ? undefined
    : sessionManager.findBranchEntryIndex?.(options.cursor)
      ?? entries.findIndex((entry) => entry.id === options.cursor);
  const cursorEntryIndex = locatedCursorIndex === -1 ? undefined : locatedCursorIndex;
  const cursorEntry = cursorEntryIndex === undefined ? undefined : entries[cursorEntryIndex];
  if (
    (options.cursor !== undefined && locatedCursorIndex === -1)
    || (cursorEntryIndex !== undefined && (!cursorEntry || !projectEntryRecord(cursorEntry, cursorEntryIndex)))
  ) {
    throw new ProtocolRequestError({
      code: "INVALID_PAYLOAD",
      message: "The message page cursor does not exist in the active session branch.",
      recoverable: true
    });
  }

  const collectedPage = direction === "older"
    ? collectOlder(entries, cursorEntryIndex ?? entries.length, limit)
    : collectNewer(entries, cursorEntryIndex === undefined ? 0 : cursorEntryIndex + 1, limit);
  const normalized = normalizeMessagesWithAdapters(
    collectedPage.map((record) => record.message),
    collectedPage.map((record) => record.id),
    resolveToolAdapter,
    projectImageAsset
  );
  const bounded = fitPageToByteBudget(collectedPage, normalized, direction);
  const page = bounded.records;
  const first = page[0];
  const last = page.at(-1);
  const hasOlder = direction === "older"
    ? bounded.truncated || hasVisibleEntry(entries, 0, first?.entryIndex ?? (cursorEntryIndex ?? entries.length))
    : cursorEntryIndex !== undefined && hasVisibleEntry(entries, 0, cursorEntryIndex + 1);
  const hasNewer = direction === "older"
    ? cursorEntryIndex !== undefined && hasVisibleEntry(entries, cursorEntryIndex, entries.length)
    : bounded.truncated || hasVisibleEntry(entries, (last?.entryIndex ?? cursorEntryIndex ?? -1) + 1, entries.length);
  return {
    sessionId: sessionManager.getSessionId(),
    messages: bounded.messages,
    ...(first === undefined ? {} : { startCursor: first.id }),
    ...(last === undefined ? {} : { endCursor: last.id }),
    hasOlder,
    hasNewer
  };
}

function fitPageToByteBudget(
  records: MessageEntryRecord[],
  messages: ReturnType<typeof normalizeMessagesWithAdapters>,
  direction: "older" | "newer"
): { records: MessageEntryRecord[]; messages: ReturnType<typeof normalizeMessagesWithAdapters>; truncated: boolean } {
  let bytes = 512;
  if (direction === "newer") {
    let end = 0;
    while (end < messages.length) {
      const nextBytes = projectedJsonBytes(messages[end]);
      if (end > 0 && bytes + nextBytes > MAX_CONVERSATION_PAGE_JSON_BYTES) break;
      bytes += nextBytes;
      end += 1;
    }
    return { records: records.slice(0, end), messages: messages.slice(0, end), truncated: end < records.length };
  }

  let start = messages.length;
  while (start > 0) {
    const nextBytes = projectedJsonBytes(messages[start - 1]);
    if (start < messages.length && bytes + nextBytes > MAX_CONVERSATION_PAGE_JSON_BYTES) break;
    bytes += nextBytes;
    start -= 1;
  }
  return { records: records.slice(start), messages: messages.slice(start), truncated: start > 0 };
}

function projectedJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8") + 1;
}

interface MessageEntryRecord {
  id: string;
  message: unknown;
  entryIndex: number;
}

function collectOlder(entries: SessionEntry[], end: number, limit: number): MessageEntryRecord[] {
  const records: MessageEntryRecord[] = [];
  for (let index = end - 1; index >= 0 && records.length < limit; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    const record = projectEntryRecord(entry, index);
    if (record) records.push(record);
  }
  records.reverse();
  return records;
}

function collectNewer(entries: SessionEntry[], start: number, limit: number): MessageEntryRecord[] {
  const records: MessageEntryRecord[] = [];
  for (let index = start; index < entries.length && records.length < limit; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const record = projectEntryRecord(entry, index);
    if (record) records.push(record);
  }
  return records;
}

function hasVisibleEntry(entries: SessionEntry[], start: number, end: number): boolean {
  for (let index = Math.max(0, start); index < Math.min(end, entries.length); index += 1) {
    const entry = entries[index];
    if (entry && projectEntryRecord(entry, index)) return true;
  }
  return false;
}

function projectEntryRecord(entry: SessionEntry, entryIndex: number): MessageEntryRecord | undefined {
  if (entry.type === "custom_message" && !entry.display) return undefined;
  const [message] = sessionEntryToContextMessages(entry);
  return message === undefined ? undefined : { id: entry.id, message, entryIndex };
}
