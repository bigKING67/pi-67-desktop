import { createHash, createHmac } from "node:crypto";
import { lstat } from "node:fs/promises";
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  MAX_MESSAGE_SEARCH_SNIPPET_CHARS,
  MAX_WORKSPACE_MESSAGE_SEARCH_RESULTS,
  RuntimeError,
  type WorkspaceMessageSearchItem,
  type WorkspaceMessageSearchResult
} from "@pi67/domain";
import { sanitizeRuntimeText } from "./runtime-redaction.js";
import type {
  SessionCatalogRecord,
  SessionContentIndexCandidate,
  SessionContentIndexDocument,
  SessionContentIndexMessage,
  IndexedSqliteSessionCatalog
} from "./sqlite-session-catalog.js";

const MAX_SESSION_FILE_BYTES = 16 * 1024 * 1024;
const MAX_INDEXED_BRANCH_ENTRIES = 20_000;
const MAX_INDEXED_MESSAGE_CHARS = 64 * 1024;
const MAX_MESSAGE_TOKEN_HASHES = 8_192;
const MAX_SESSION_TOKEN_HASHES = 200_000;
const CONTENT_INDEX_WORKERS = 4;
const CONTENT_INDEX_WRITE_BATCH = 16;
const CANDIDATE_MULTIPLIER = 8;

export interface SessionContentIndexSearchOptions {
  workspaceId: string;
  workspaceKey: string;
  query: string;
  records: readonly SessionCatalogRecord[];
  catalogIncomplete: boolean;
  catalogSkippedCount: number;
  sqlite: IndexedSqliteSessionCatalog;
  signal?: AbortSignal;
}

export interface SessionContentIndexSearchOutcome extends WorkspaceMessageSearchResult {
  staleFileIdentities: string[];
}

export function sessionContentProjectionVersion(record: SessionCatalogRecord): string {
  return createHash("sha256")
    .update(record.fileIdentity)
    .update("\0")
    .update(record.path)
    .update("\0")
    .update(String(record.modifiedAt))
    .update("\0")
    .update(String(record.messageCount))
    .digest("hex");
}

export async function indexSessionContentRecords(options: {
  records: readonly SessionCatalogRecord[];
  sqlite: IndexedSqliteSessionCatalog;
  isCurrent(record: SessionCatalogRecord): boolean;
}): Promise<void> {
  const versions = options.sqlite.contentIndexVersions();
  const pending = options.records.filter((record) => (
    versions.get(record.fileIdentity) !== sessionContentProjectionVersion(record)
  ));
  if (pending.length === 0) return;
  const salt = options.sqlite.contentIndexSalt();
  for (let offset = 0; offset < pending.length; offset += CONTENT_INDEX_WRITE_BATCH) {
    const records = pending.slice(offset, offset + CONTENT_INDEX_WRITE_BATCH);
    const documents: Array<{ record: SessionCatalogRecord; document: SessionContentIndexDocument }> = [];
    let next = 0;
    const worker = async () => {
      while (next < records.length) {
        const record = records[next++];
        if (!record) return;
        const projectionVersion = sessionContentProjectionVersion(record);
        let document: SessionContentIndexDocument;
        try {
          document = await buildSessionContentIndexDocument(record, projectionVersion, salt);
        } catch {
          document = {
            fileIdentity: record.fileIdentity,
            projectionVersion,
            indexedEntries: 0,
            incomplete: true,
            messages: []
          };
        }
        documents.push({ record, document });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONTENT_INDEX_WORKERS, records.length) }, worker));
    options.sqlite.replaceContentIndexes(documents.flatMap(({ record, document }) => (
      options.isCurrent(record) ? [document] : []
    )));
  }
}

export async function searchIndexedSessionContent(
  options: SessionContentIndexSearchOptions
): Promise<SessionContentIndexSearchOutcome> {
  const query = normalizeSessionContentSearch(options.query);
  const queryCharacters = Array.from(query);
  if (queryCharacters.length < 2) {
    throw new RuntimeError("INVALID_PAYLOAD", "Session content search requires at least two characters.");
  }
  throwIfAborted(options.signal);
  const tokenHashes = tokenHashesForText(query, options.sqlite.contentIndexSalt());
  const candidates = options.sqlite.queryContentIndex(
    options.workspaceKey,
    tokenHashes,
    MAX_WORKSPACE_MESSAGE_SEARCH_RESULTS * CANDIDATE_MULTIPLIER
  );
  const recordByIdentity = new Map(options.records.map((record) => [record.fileIdentity, record]));
  const items: WorkspaceMessageSearchItem[] = [];
  const acceptedSessions = new Set<string>();
  const staleFileIdentities = new Set<string>();
  const candidatesBySession = groupCandidates(candidates);
  for (const [fileIdentity, sessionCandidates] of candidatesBySession) {
    if (items.length >= MAX_WORKSPACE_MESSAGE_SEARCH_RESULTS) break;
    throwIfAborted(options.signal);
    const record = recordByIdentity.get(fileIdentity);
    if (!record) {
      staleFileIdentities.add(fileIdentity);
      continue;
    }
    try {
      const manager = SessionManager.open(record.path, undefined, record.cwd);
      const entries = new Map(manager.getBranch().map((entry) => [entry.id, entry]));
      for (const candidate of sessionCandidates) {
        const searchable = searchableEntry(entries.get(candidate.messageId));
        if (!searchable) {
          staleFileIdentities.add(fileIdentity);
          continue;
        }
        const text = normalizeSessionContentSearch(searchable.text);
        if (contentFingerprint(text) !== candidate.contentFingerprint) {
          staleFileIdentities.add(fileIdentity);
          continue;
        }
        const matchIndex = text.indexOf(query);
        if (matchIndex < 0) continue;
        items.push({
          sessionFileIdentity: record.fileIdentity,
          sessionPath: record.path,
          sessionName: effectiveSessionName(record),
          messageId: candidate.messageId,
          role: candidate.role,
          snippet: boundedSnippet(text, matchIndex, query.length),
          ...(candidate.createdAt === undefined ? {} : { createdAt: candidate.createdAt })
        });
        acceptedSessions.add(fileIdentity);
        break;
      }
    } catch {
      staleFileIdentities.add(fileIdentity);
    }
  }
  const coverage = options.sqlite.contentIndexCoverage(options.workspaceKey);
  const missingSessions = Math.max(0, options.records.length - coverage.sessionCount);
  const truncated = candidates.length >= MAX_WORKSPACE_MESSAGE_SEARCH_RESULTS * CANDIDATE_MULTIPLIER
    || acceptedSessions.size >= MAX_WORKSPACE_MESSAGE_SEARCH_RESULTS;
  const incomplete = options.catalogIncomplete
    || missingSessions > 0
    || coverage.incompleteCount > 0
    || staleFileIdentities.size > 0
    || truncated;
  return {
    workspaceId: options.workspaceId,
    query,
    items,
    sessionsVisited: coverage.sessionCount,
    entriesVisited: coverage.indexedEntries,
    skippedCount: options.catalogSkippedCount
      + missingSessions
      + coverage.incompleteCount
      + staleFileIdentities.size,
    incomplete,
    truncated,
    staleFileIdentities: [...staleFileIdentities]
  };
}

export function normalizeSessionContentSearch(value: string): string {
  return sanitizeRuntimeText(value).normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function tokenHashesForText(value: string, salt: string): string[] {
  if (!/^[0-9a-f]{64}$/u.test(salt)) throw new Error("Content index salt is invalid.");
  const characters = Array.from(normalizeSessionContentSearch(value));
  const hashes = new Set<string>();
  for (let index = 0; index + 1 < characters.length; index += 1) {
    hashes.add(createHmac("sha256", Buffer.from(salt, "hex"))
      .update(characters[index]!)
      .update(characters[index + 1]!)
      .digest("hex")
      .slice(0, 32));
  }
  return [...hashes];
}

async function buildSessionContentIndexDocument(
  record: SessionCatalogRecord,
  projectionVersion: string,
  salt: string
): Promise<SessionContentIndexDocument> {
  const info = await lstat(record.path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SESSION_FILE_BYTES) {
    throw new Error("Session content source is outside the index bounds.");
  }
  const manager = SessionManager.open(record.path, undefined, record.cwd);
  const branch = manager.getBranch();
  const boundedBranch = branch.length <= MAX_INDEXED_BRANCH_ENTRIES
    ? branch
    : branch.slice(branch.length - MAX_INDEXED_BRANCH_ENTRIES);
  const messages: SessionContentIndexMessage[] = [];
  let tokenCount = 0;
  let incomplete = boundedBranch.length < branch.length;
  for (const [entryOrder, entry] of boundedBranch.entries()) {
    const searchable = searchableEntry(entry);
    if (!searchable) continue;
    const normalized = normalizeSessionContentSearch(searchable.text);
    if (!normalized) continue;
    const characters = Array.from(normalized);
    const boundedText = characters.slice(0, MAX_INDEXED_MESSAGE_CHARS).join("");
    let tokenHashes = tokenHashesForText(boundedText, salt);
    if (characters.length > MAX_INDEXED_MESSAGE_CHARS || tokenHashes.length > MAX_MESSAGE_TOKEN_HASHES) {
      incomplete = true;
      tokenHashes = tokenHashes.slice(0, MAX_MESSAGE_TOKEN_HASHES);
    }
    const remaining = MAX_SESSION_TOKEN_HASHES - tokenCount;
    if (remaining <= 0) {
      incomplete = true;
      break;
    }
    if (tokenHashes.length > remaining) {
      incomplete = true;
      tokenHashes = tokenHashes.slice(0, remaining);
    }
    tokenCount += tokenHashes.length;
    messages.push({
      messageId: entry.id,
      role: searchable.role,
      entryOrder,
      contentFingerprint: contentFingerprint(normalized),
      tokenHashes,
      ...(searchable.createdAt === undefined ? {} : { createdAt: searchable.createdAt })
    });
  }
  return {
    fileIdentity: record.fileIdentity,
    projectionVersion,
    indexedEntries: messages.length,
    incomplete,
    messages
  };
}

function searchableEntry(entry: SessionEntry | undefined): {
  role: "user" | "assistant";
  text: string;
  createdAt?: number;
} | undefined {
  if (entry?.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) {
    return undefined;
  }
  const message = entry.message as unknown as { content?: unknown; timestamp?: unknown };
  const raw = typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content.flatMap((part) => {
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

function groupCandidates(candidates: readonly SessionContentIndexCandidate[]) {
  const grouped = new Map<string, SessionContentIndexCandidate[]>();
  for (const candidate of candidates) {
    const current = grouped.get(candidate.fileIdentity);
    if (current) current.push(candidate);
    else grouped.set(candidate.fileIdentity, [candidate]);
  }
  return grouped;
}

function effectiveSessionName(record: SessionCatalogRecord): string {
  return record.explicitName ?? record.automaticName ?? "未命名对话";
}

function contentFingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Session content search was cancelled.", "AbortError");
}
