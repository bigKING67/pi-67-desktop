import { Type, Value, type Static } from "./typebox-schema.js";

const RequestId = Type.String({ minLength: 1, maxLength: 128 });
const Uuid = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" });
const Cursor = Type.String({ pattern: "^(0|[1-9][0-9]{0,18})$" });
const Epoch = Type.Union([Uuid, Type.Null()]);
const IndexSnapshot = Type.Object({ epoch: Uuid, cursor: Cursor }, { additionalProperties: false });
const Scope = Type.Object({ teamId: Uuid, scopeKind: Type.Union([Type.Literal("team"), Type.Literal("project")]), scopeId: Uuid }, { additionalProperties: false });
const ModelFields = { endpoint: Type.String({ minLength: 1, maxLength: 2048 }), model: Type.String({ minLength: 1, maxLength: 128 }) };
const IndexModels = Type.Object({
  embedding: Type.Object({ ...ModelFields, dimension: Type.Integer({ minimum: 4, maximum: 4096, multipleOf: 4 }) }, { additionalProperties: false }),
  extraction: Type.Object(ModelFields, { additionalProperties: false })
}, { additionalProperties: false });
const QueryVector = Type.Array(Type.Number({ minimum: -3.4028234663852886e38, maximum: 3.4028234663852886e38 }), { minItems: 4, maxItems: 4096 });
const QueryHit = Type.Object({ assetId: Uuid, contentRevision: Type.String({ pattern: "^[a-f0-9]{64}$" }), score: Type.Number() }, { additionalProperties: false });

/** Private Host/Main protocol only. Open selects a scope, never a filesystem
 * path, local profile, user, service, credential or self-issued access grant.
 * Main must authorize scope and bind the opaque handle to its current identity
 * generation. These schemas do not themselves implement that authorization. */
export const SharedKnowledgeReceiptRequestSchema = Type.Union([
  Type.Object({ type: Type.Literal("shared-knowledge-index-read-current"), requestId: RequestId, handleId: Uuid,
    assetId: Uuid, contentRevision: QueryHit.properties.contentRevision }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-read"), requestId: RequestId, handleId: Uuid,
    snapshot: IndexSnapshot, assetId: Uuid, contentRevision: QueryHit.properties.contentRevision }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-query-prepare"), requestId: RequestId, handleId: Uuid }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-query"), requestId: RequestId, handleId: Uuid, queryId: Uuid,
    vector: QueryVector, limit: Type.Integer({ minimum: 1, maximum: 100 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-prepare"), requestId: RequestId, handleId: Uuid, models: IndexModels }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-register"), requestId: RequestId, handleId: Uuid, indexId: Uuid, workerRequestId: Uuid }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-cancel"), requestId: RequestId, handleId: Uuid, indexId: Uuid }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-wait"), requestId: RequestId, handleId: Uuid, indexId: Uuid }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-publish"), requestId: RequestId, handleId: Uuid, indexId: Uuid }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-receipt-open"), requestId: RequestId, scope: Scope }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-receipt-append"), requestId: RequestId, handleId: Uuid,
    fromCursor: Cursor, epoch: Epoch, permissionRevision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    pageJson: Type.String({ minLength: 1, maxLength: 2 * 1024 * 1024 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-receipt-close"), requestId: RequestId, handleId: Uuid }, { additionalProperties: false })
]);
const Progress = Type.Object({ epoch: Epoch, cursor: Cursor }, { additionalProperties: false });
export const SharedKnowledgeReceiptResultSchema = Type.Union([
  Type.Object({ type: Type.Literal("shared-knowledge-index-read-current-result"), requestId: RequestId, ok: Type.Literal(true),
    snapshot: IndexSnapshot, assetId: Uuid, contentRevision: QueryHit.properties.contentRevision,
    canonicalContent: Type.String({ minLength: 1, maxLength: 1024 * 1024 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-read-result"), requestId: RequestId, ok: Type.Literal(true),
    snapshot: IndexSnapshot, assetId: Uuid, contentRevision: QueryHit.properties.contentRevision,
    canonicalContent: Type.String({ minLength: 1, maxLength: 1024 * 1024 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-query-prepare-result"), requestId: RequestId, ok: Type.Literal(true),
    queryId: Uuid, model: IndexModels.properties.embedding, snapshot: IndexSnapshot }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-query-result"), requestId: RequestId, ok: Type.Literal(true),
    snapshot: IndexSnapshot, hits: Type.Array(QueryHit, { maxItems: 100 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-prepare-result"), requestId: RequestId, ok: Type.Literal(true), indexId: Uuid }, { additionalProperties: false }),
  Type.Object({ type: Type.Union([Type.Literal("shared-knowledge-index-register-result"), Type.Literal("shared-knowledge-index-cancel-result")]), requestId: RequestId, ok: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-wait-result"), requestId: RequestId, ok: Type.Literal(true), state: Type.Literal("verified-unpublished"), snapshot: IndexSnapshot }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-index-publish-result"), requestId: RequestId, ok: Type.Literal(true), state: Type.Literal("published-local"), snapshot: IndexSnapshot }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-receipt-open-result"), requestId: RequestId, ok: Type.Literal(true),
    handleId: Uuid, userId: Type.String({ minLength: 1, maxLength: 2048 }), endpoint: Type.String({ minLength: 1, maxLength: 2048 }),
    progress: Progress }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-receipt-append-result"), requestId: RequestId, ok: Type.Literal(true),
    progress: Progress }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("shared-knowledge-receipt-close-result"), requestId: RequestId, ok: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object({ type: Type.Union([Type.Literal("shared-knowledge-index-read-current-result"), Type.Literal("shared-knowledge-index-read-result"), Type.Literal("shared-knowledge-index-query-prepare-result"), Type.Literal("shared-knowledge-index-query-result"), Type.Literal("shared-knowledge-receipt-open-result"), Type.Literal("shared-knowledge-receipt-append-result"), Type.Literal("shared-knowledge-receipt-close-result"), Type.Literal("shared-knowledge-index-prepare-result"), Type.Literal("shared-knowledge-index-register-result"), Type.Literal("shared-knowledge-index-cancel-result"), Type.Literal("shared-knowledge-index-wait-result"), Type.Literal("shared-knowledge-index-publish-result")]),
    requestId: RequestId, ok: Type.Literal(false), errorCode: Type.Union([
      Type.Literal("NOT_SIGNED_IN"), Type.Literal("SCOPE_DENIED"), Type.Literal("STALE_HANDLE"),
      Type.Literal("INVALID_PAGE"), Type.Literal("CAPACITY_EXCEEDED"), Type.Literal("PERSISTENCE_FAILED"), Type.Literal("INDEX_FAILED"), Type.Literal("QUERY_FAILED"), Type.Literal("PUBLICATION_INDETERMINATE")
    ]) }, { additionalProperties: false })
]);
export type SharedKnowledgeReceiptRequest = Static<typeof SharedKnowledgeReceiptRequestSchema>;
export type SharedKnowledgeReceiptResult = Static<typeof SharedKnowledgeReceiptResultSchema>;
export type SharedKnowledgeIndexSnapshot = Static<typeof IndexSnapshot>;

/** Main-initiated, metadata-only observation. Cancellation and invalidation are
 * exact-request scoped; no model/read grant or private localProfileId is sent. */
export const SharedKnowledgeIndexHeadRequestSchema = Type.Union([
  Type.Object({ type: Type.Literal("team-index-head-check"), requestId: Uuid,
    owner: Type.Object({ ...Scope.properties, userId: Type.String({ minLength: 1, maxLength: 2048 }),
      endpoint: Type.String({ minLength: 1, maxLength: 2048 }) }, { additionalProperties: false }),
    models: IndexModels, snapshot: IndexSnapshot, permissionRevision: Type.String({ pattern: "^[a-f0-9]{64}$" }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("team-index-head-cancel"), requestId: Uuid }, { additionalProperties: false })
]);
export const SharedKnowledgeIndexHeadResultSchema = Type.Union([
  Type.Object({ type: Type.Literal("team-index-head-result"), requestId: Uuid, ok: Type.Literal(true), validUntil: Type.Integer({ minimum: 1, maximum: 8_640_000_000_000_000 }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("team-index-head-result"), requestId: Uuid, ok: Type.Literal(false) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("team-index-head-invalidated"), requestId: Uuid }, { additionalProperties: false })
]);
export type SharedKnowledgeIndexHeadRequest = Static<typeof SharedKnowledgeIndexHeadRequestSchema>;
export type SharedKnowledgeIndexHeadCheck = Extract<SharedKnowledgeIndexHeadRequest, { type: "team-index-head-check" }>;
export type SharedKnowledgeIndexHeadResult = Static<typeof SharedKnowledgeIndexHeadResultSchema>;
export function isSharedKnowledgeIndexHeadRequest(value: unknown): value is SharedKnowledgeIndexHeadRequest {
  if (!Value.Check(SharedKnowledgeIndexHeadRequestSchema, value)) return false;
  if (value.type === "team-index-head-cancel") return true;
  const { owner, snapshot } = value;
  if (owner.scopeKind === "team" && owner.teamId !== owner.scopeId || snapshot.cursor === "0" || !validProgress(snapshot.epoch, snapshot.cursor)) return false;
  try {
    const endpoint = new URL(owner.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || /[\s\p{Cc}\\?#]/u.test(owner.endpoint)) return false;
  } catch { return false; }
  return isSharedKnowledgeReceiptRequest({ type: "shared-knowledge-index-prepare", requestId: value.requestId, handleId: value.requestId, models: value.models });
}
export function isSharedKnowledgeIndexHeadResult(value: unknown): value is SharedKnowledgeIndexHeadResult {
  return Value.Check(SharedKnowledgeIndexHeadResultSchema, value);
}

export function isSharedKnowledgeReceiptRequest(value: unknown): value is SharedKnowledgeReceiptRequest {
  if (!Value.Check(SharedKnowledgeReceiptRequestSchema, value)) return false;
  if (value.type === "shared-knowledge-index-read") return value.snapshot.cursor !== "0" && validProgress(value.snapshot.epoch, value.snapshot.cursor);
  if (value.type === "shared-knowledge-index-query-prepare" || value.type === "shared-knowledge-index-read-current") return true;
  if (value.type === "shared-knowledge-index-query") return value.vector.length % 4 === 0 && value.vector.every(Number.isFinite);
  if (value.type === "shared-knowledge-receipt-open") return value.scope.scopeKind !== "team" || value.scope.teamId === value.scope.scopeId;
  if (value.type === "shared-knowledge-receipt-close") return true;
  if (value.type === "shared-knowledge-index-prepare") return Object.values(value.models).every(model => {
    try {
      const url = new URL(model.endpoint);
      return !/[\s\p{Cc}\\?#]/u.test(model.endpoint)
        && !url.username && !url.password && url.protocol === "https:"
        && !/[\s\p{Cc}]/u.test(model.model);
    } catch { return false; }
  });
  if (value.type === "shared-knowledge-index-register" || value.type === "shared-knowledge-index-cancel" || value.type === "shared-knowledge-index-wait" || value.type === "shared-knowledge-index-publish") return true;
  return validProgress(value.epoch, value.fromCursor)
    && new TextEncoder().encode(value.pageJson).byteLength <= 2 * 1024 * 1024
    && !/[\uD800-\uDFFF]/u.test(value.pageJson);
}

export function isSharedKnowledgeReceiptResult(value: unknown): value is SharedKnowledgeReceiptResult {
  if (!Value.Check(SharedKnowledgeReceiptResultSchema, value)) return false;
  if (value.ok && (value.type === "shared-knowledge-index-read-result" || value.type === "shared-knowledge-index-read-current-result")) return value.snapshot.cursor !== "0" && validProgress(value.snapshot.epoch, value.snapshot.cursor)
    && new TextEncoder().encode(value.canonicalContent).byteLength <= 1024 * 1024 && !/[\uD800-\uDFFF]/u.test(value.canonicalContent);
  if (value.ok && (value.type === "shared-knowledge-index-query-prepare-result" || value.type === "shared-knowledge-index-query-result")) {
    if (value.snapshot.cursor === "0" || !validProgress(value.snapshot.epoch, value.snapshot.cursor)) return false;
    if (value.type === "shared-knowledge-index-query-result") return value.hits.every(hit => Number.isFinite(hit.score)) && new Set(value.hits.map(hit => hit.assetId)).size === value.hits.length;
    return isSharedKnowledgeReceiptRequest({ type: "shared-knowledge-index-prepare", requestId: value.requestId, handleId: value.queryId,
      models: { embedding: value.model, extraction: { endpoint: value.model.endpoint, model: value.model.model } } });
  }
  if (!value.ok && value.errorCode === "PUBLICATION_INDETERMINATE") return value.type === "shared-knowledge-index-publish-result";
  if (value.ok && (value.type === "shared-knowledge-index-wait-result" || value.type === "shared-knowledge-index-publish-result")) return value.snapshot.cursor !== "0" && validProgress(value.snapshot.epoch, value.snapshot.cursor);
  if (!value.ok || !("progress" in value)) return true;
  return validProgress(value.progress.epoch, value.progress.cursor);
}

function validProgress(epoch: string | null, cursor: string): boolean {
  return BigInt(cursor) <= 9_223_372_036_854_775_807n && (epoch !== null || cursor === "0");
}
