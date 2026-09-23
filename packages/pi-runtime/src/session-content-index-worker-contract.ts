import { isResponseEnvelope, responseEnvelope } from "@pi67/protocol";
import { isAbsolute } from "node:path";
import type { SessionCatalogRecord } from "./sqlite-session-catalog.js";
import { sanitizeSessionCatalogRecord } from "./session-catalog-projection.js";
import type { SessionContentIndexSearchOutcome } from "./session-content-index.js";

export interface ContentIndexWorkerRequest {
  id: number;
  sourceKey: string;
  records: readonly SessionCatalogRecord[];
  search?: {
    workspaceId: string;
    workspaceKey: string;
    query: string;
    catalogIncomplete: boolean;
    catalogSkippedCount: number;
  };
}
export type ContentIndexWorkerReply =
  | { id: number; ok: true; result?: SessionContentIndexSearchOutcome }
  | { id: number; ok: false };

export function validateContentIndexRequest(value: unknown): ContentIndexWorkerRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid index request.");
  const request = value as ContentIndexWorkerRequest;
  if (!Number.isSafeInteger(request.id) || request.id < 1
    || typeof request.sourceKey !== "string" || request.sourceKey.length < 1 || request.sourceKey.length > 512
    || !Array.isArray(request.records) || request.records.length > 100_000) throw new Error("Invalid index request.");
  for (const record of request.records) {
    if (!record || typeof record !== "object" || !sanitizeSessionCatalogRecord(record)
      || !isAbsolute(record.path) || !isAbsolute(record.cwd)) throw new Error("Invalid index record.");
  }
  const search = request.search;
  if (search !== undefined && (typeof search !== "object" || search === null
    || typeof search.workspaceId !== "string" || search.workspaceId.length > 512
    || typeof search.workspaceKey !== "string" || search.workspaceKey.length > 4096
    || typeof search.query !== "string" || search.query.length > 512
    || typeof search.catalogIncomplete !== "boolean"
    || !Number.isSafeInteger(search.catalogSkippedCount) || search.catalogSkippedCount < 0)) {
    throw new Error("Invalid index search.");
  }
  if (!contentIndexRequestWithinBudget(request)) throw new Error("Content index request is too large.");
  return request;
}

export function isContentIndexReply(value: unknown, request: ContentIndexWorkerRequest): value is ContentIndexWorkerReply {
  if (!value || typeof value !== "object") return false;
  const reply = value as ContentIndexWorkerReply;
  if (reply.id !== request.id || typeof reply.ok !== "boolean") return false;
  if (!reply.ok) return true;
  if (!request.search) return reply.result === undefined;
  if (!reply.result || typeof reply.result !== "object") return false;
  const { staleFileIdentities, ...result } = reply.result;
  if (!Array.isArray(staleFileIdentities) || staleFileIdentities.length > 100_000
    || staleFileIdentities.some(id => typeof id !== "string" || id.length > 1024)) return false;
  // Reuse the public result contract without introducing another search schema.
  return result.workspaceId === request.search.workspaceId && isResponseEnvelope(responseEnvelope(
    "content-index-validation", 1, { scope: "workspace", workspaceId: request.search.workspaceId },
    { type: "session.catalog.contentSearch", ok: true, result }
  ));
}

export function contentIndexRequestWithinBudget(request: Omit<ContentIndexWorkerRequest, "id">): boolean {
  if (request.records.length > 100_000) return false;
  let bytes = 4096;
  for (const record of request.records) {
    bytes += 256;
    for (const value of Object.values(record)) {
      if (typeof value === "string") bytes += value.length * 4;
    }
    if (bytes > 16 * 1024 * 1024) return false;
  }
  return true;
}
