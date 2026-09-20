export interface KnowledgeSyncExpectation {
  teamId: string;
  scopeKind: "team" | "project";
  scopeId: string;
  epoch: string | null;
  cursor: string;
  permissionRevision: string;
  limit: number;
}

export interface KnowledgeSyncChange {
  cursor: string;
  assetId: string;
  contentRevision: string;
  operation: "upsert" | "revoke";
  canonicalContent?: string;
}

/** Validated receipt data only. This neither advances durable cursors nor grants
 * model access/index freshness. Callers must preserve account/service identity. */
export interface KnowledgeSyncPage {
  teamId: string;
  scopeKind: "team" | "project";
  scopeId: string;
  epoch: string | null;
  nextCursor: string;
  headCursor: string;
  hasMore: boolean;
  issuedAt: number;
  leaseExpiresAt: number;
  permissionRevision: string;
  changes: KnowledgeSyncChange[];
}

const MAX_CURSOR = 9_223_372_036_854_775_807n;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;

export function decodeKnowledgeSyncPage(bytes: Uint8Array, expected: KnowledgeSyncExpectation, sha256: (text: string) => string): KnowledgeSyncPage {
  if (bytes.byteLength > 2 * 1024 * 1024) throw invalidResponse("sync.bytes");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw invalidResponse("sync.json"); }
  const page = asRecord(value);
  exactKeys(page, ["teamId", "scopeKind", "scopeId", "epoch", "nextCursor", "headCursor", "hasMore", "issuedAt", "leaseExpiresAt", "permissionRevision", "changes"]);
  const start = cursor(expected.cursor);
  if (!Number.isInteger(expected.limit) || expected.limit < 1 || expected.limit > 100
      || (start > 0n && expected.epoch === null)
      || page.teamId !== expected.teamId || page.scopeKind !== expected.scopeKind || page.scopeId !== expected.scopeId
      || page.permissionRevision !== expected.permissionRevision
      || (expected.scopeKind === "team" && expected.scopeId !== expected.teamId)) throw invalidResponse("sync.scope");
  const teamId = uuid(page.teamId), scopeId = uuid(page.scopeId);
  const permissionRevision = hash(page.permissionRevision);
  const epoch = page.epoch === null ? null : uuid(page.epoch);
  if (expected.epoch !== null && epoch !== expected.epoch) throw invalidResponse("sync.epoch");
  const next = cursor(page.nextCursor), head = cursor(page.headCursor);
  if (next < start || next > head || typeof page.hasMore !== "boolean" || page.hasMore !== (next < head)) throw invalidResponse("sync.cursor");
  const issuedAt = timestamp(page.issuedAt), leaseExpiresAt = timestamp(page.leaseExpiresAt);
  if (leaseExpiresAt <= issuedAt || leaseExpiresAt - issuedAt > 300_000) throw invalidResponse("sync.lease");
  if (!Array.isArray(page.changes) || page.changes.length > expected.limit) throw invalidResponse("sync.changes");
  let position = start;
  const changes = page.changes.map((value): KnowledgeSyncChange => {
    const change = asRecord(value);
    const upsert = change.operation === "upsert";
    if (!upsert && change.operation !== "revoke") throw invalidResponse("sync.operation");
    exactKeys(change, ["cursor", "assetId", "contentRevision", "operation", ...(upsert ? ["canonicalContent"] : [])]);
    const eventCursor = cursor(change.cursor);
    if (eventCursor !== position + 1n || eventCursor > head) throw invalidResponse("sync.gap");
    position = eventCursor;
    const assetId = uuid(change.assetId), contentRevision = hash(change.contentRevision);
    const common = { cursor: eventCursor.toString(), assetId, contentRevision };
    if (!upsert) return { ...common, operation: "revoke" };
    const canonicalContent = canonical(change.canonicalContent, contentRevision, sha256);
    return { ...common, operation: "upsert", canonicalContent };
  });
  if (position !== next || (changes.length === 0 && next < head)
      || (epoch === null && (head !== 0n || changes.length !== 0))) throw invalidResponse("sync.progress");
  return { teamId, scopeKind: expected.scopeKind, scopeId, epoch, nextCursor: next.toString(), headCursor: head.toString(),
    hasMore: next < head, issuedAt, leaseExpiresAt, permissionRevision, changes };
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw invalidResponse("sync.fields");
}
function cursor(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/u.test(value)) throw invalidResponse("sync.cursor");
  const parsed = BigInt(value);
  if (parsed > MAX_CURSOR) throw invalidResponse("sync.cursor");
  return parsed;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw invalidResponse("sync.identity");
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) throw invalidResponse("sync.revision");
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || !Number.isFinite(Date.parse(value))) throw invalidResponse("sync.time");
  return Date.parse(value);
}
function canonical(value: unknown, revision: string, sha256: (text: string) => string): string {
  decodeKnowledgeCanonicalContent(value, revision, sha256);
  return value as string;
}

/** Same hash/Unicode/size contract for sync and exact-version local body reads.
 * Parsing proves content identity, never Session ownership or model permission. */
export function decodeKnowledgeCanonicalContent(value: unknown, revision: string, sha256: (text: string) => string): {
  kind: "experience" | "sop"; title: string; summary: string; body: string;
} {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > 1024 * 1024
      || sha256(value) !== revision) throw invalidResponse("sync.content");
  let tuple: unknown;
  try { tuple = JSON.parse(value) as unknown; } catch { throw invalidResponse("sync.content"); }
  if (!Array.isArray(tuple) || tuple.length !== 5 || tuple[0] !== "newmoney.knowledge.v1"
      || !["experience", "sop"].includes(tuple[1] as string)) throw invalidResponse("sync.content");
  for (const [index, maximum] of [[2, 160], [3, 2000], [4, 100_000]] as const) {
    const text: unknown = tuple[index];
    if (typeof text !== "string" || text.trim().length === 0 || text.includes("\0")
        || /[\uD800-\uDFFF]/u.test(text) || Array.from(text).length > maximum) throw invalidResponse("sync.content");
  }
  return { kind: tuple[1] as "experience" | "sop", title: tuple[2] as string, summary: tuple[3] as string, body: tuple[4] as string };
}

export class KnowledgeSyncValidationError extends Error {
  constructor(readonly field: string) { super(`Invalid knowledge sync field: ${field}.`); }
}
function invalidResponse(field: string): KnowledgeSyncValidationError { return new KnowledgeSyncValidationError(field); }
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidResponse("object");
  return value as Record<string, unknown>;
}
