import { lstat } from "node:fs/promises";
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  MAX_MESSAGE_SEARCH_SNIPPET_CHARS,
  MAX_WORKSPACE_MESSAGE_SEARCH_ENTRIES,
  MAX_WORKSPACE_MESSAGE_SEARCH_RESULTS,
  MAX_WORKSPACE_MESSAGE_SEARCH_SESSIONS,
  type SessionSummary,
  type WorkspaceMessageSearchItem,
  type WorkspaceMessageSearchResult
} from "@pi67/domain";
import { sanitizeRuntimeText } from "./runtime-redaction.js";

const MAX_SESSION_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_SESSION_BYTES = 64 * 1024 * 1024;
const DEFAULT_DEADLINE_MS = 2_000;

export interface WorkspaceSessionContentSearchOptions {
  workspaceId: string;
  query: string;
  sessions: readonly SessionSummary[];
  catalogTotal: number;
  catalogIncomplete: boolean;
  catalogSkippedCount: number;
  deadlineMs?: number;
  signal?: AbortSignal;
}

export async function searchWorkspaceSessionContent(
  options: WorkspaceSessionContentSearchOptions
): Promise<WorkspaceMessageSearchResult> {
  const query = options.query.replace(/\s+/gu, " ").trim();
  if (!query) throw new Error("A non-empty Session content search query is required.");
  const needle = query.toLocaleLowerCase();
  const ordered = [...options.sessions].sort((left, right) => (
    right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path)
  ));
  const candidates = ordered.slice(0, MAX_WORKSPACE_MESSAGE_SEARCH_SESSIONS);
  const deadline = Date.now() + Math.max(1, options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const items: WorkspaceMessageSearchItem[] = [];
  let sessionsVisited = 0;
  let entriesVisited = 0;
  let totalBytes = 0;
  let skippedCount = options.catalogSkippedCount
    + Math.max(0, options.catalogTotal - ordered.length)
    + Math.max(0, ordered.length - candidates.length);
  let incomplete = options.catalogIncomplete || skippedCount > 0;
  let truncated = false;

  for (let sessionIndex = 0; sessionIndex < candidates.length; sessionIndex += 1) {
    if (options.signal?.aborted) throw new DOMException("Session content search was cancelled.", "AbortError");
    const session = candidates[sessionIndex]!;
    if (Date.now() >= deadline || entriesVisited >= MAX_WORKSPACE_MESSAGE_SEARCH_ENTRIES) {
      skippedCount += candidates.length - sessionIndex;
      incomplete = true;
      break;
    }
    try {
      const stats = await lstat(session.path);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_SESSION_FILE_BYTES) {
        skippedCount += 1;
        incomplete = true;
        continue;
      }
      if (totalBytes + stats.size > MAX_TOTAL_SESSION_BYTES) {
        skippedCount += candidates.length - sessionIndex;
        incomplete = true;
        break;
      }
      totalBytes += stats.size;
      const manager = SessionManager.open(session.path, undefined, session.cwd);
      const branch = manager.getBranch();
      const remaining = MAX_WORKSPACE_MESSAGE_SEARCH_ENTRIES - entriesVisited;
      const entries = branch.length <= remaining ? branch : branch.slice(branch.length - remaining);
      if (entries.length < branch.length) incomplete = true;
      sessionsVisited += 1;
      entriesVisited += entries.length;
      let bestMatch: WorkspaceMessageSearchItem | undefined;
      for (const entry of entries) {
        if (options.signal?.aborted) throw new DOMException("Session content search was cancelled.", "AbortError");
        const searchable = searchableEntry(entry);
        if (!searchable) continue;
        const matchIndex = searchable.text.toLocaleLowerCase().indexOf(needle);
        if (matchIndex < 0) continue;
        const match = {
          sessionFileIdentity: session.fileIdentity,
          sessionPath: session.path,
          sessionName: session.name,
          messageId: entry.id,
          role: searchable.role,
          snippet: boundedSnippet(searchable.text, matchIndex, query.length),
          ...(searchable.createdAt === undefined ? {} : { createdAt: searchable.createdAt })
        } satisfies WorkspaceMessageSearchItem;
        if (!bestMatch || (bestMatch.role === "assistant" && match.role === "user")) bestMatch = match;
      }
      if (bestMatch) {
        if (items.length >= MAX_WORKSPACE_MESSAGE_SEARCH_RESULTS) {
          truncated = true;
          incomplete = true;
          skippedCount += candidates.length - sessionIndex;
          break;
        }
        items.push(bestMatch);
      }
    } catch {
      skippedCount += 1;
      incomplete = true;
    }
  }

  return {
    workspaceId: options.workspaceId,
    query,
    items,
    sessionsVisited,
    entriesVisited,
    skippedCount,
    incomplete,
    truncated
  };
}

function searchableEntry(entry: SessionEntry): {
  role: "user" | "assistant";
  text: string;
  createdAt?: number;
} | undefined {
  if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) {
    return undefined;
  }
  const message = entry.message as unknown as { content?: unknown; timestamp?: unknown };
  const content = message.content;
  const raw = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.flatMap((part) => {
          if (typeof part !== "object" || part === null) return [];
          const record = part as { type?: unknown; text?: unknown };
          return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
        }).join(" ")
      : "";
  const text = sanitizeRuntimeText(raw).replace(/\s+/gu, " ").trim();
  if (!text) return undefined;
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : Date.parse(entry.timestamp);
  return {
    role: entry.message.role,
    text,
    ...(Number.isFinite(timestamp) ? { createdAt: Math.max(0, Math.trunc(timestamp)) } : {})
  };
}

function boundedSnippet(text: string, matchIndex: number, queryLength: number): string {
  const start = Math.max(0, matchIndex - 72);
  const rawEnd = Math.min(text.length, Math.max(matchIndex + queryLength + 72, start + 1));
  const prefix = start > 0;
  const suffix = rawEnd < text.length;
  const budget = MAX_MESSAGE_SEARCH_SNIPPET_CHARS - Number(prefix) - Number(suffix);
  const value = Array.from(text.slice(start, rawEnd)).slice(0, budget).join("");
  return `${prefix ? "…" : ""}${value}${suffix ? "…" : ""}`;
}
