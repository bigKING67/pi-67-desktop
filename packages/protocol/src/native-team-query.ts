import { Type, Value, type Static } from "./typebox-schema.js";

// One request/result per admitted native process, on inherited FD3 only. This is
// not a Host/Renderer command, model grant, or permission to return source bodies.
export const MAX_NATIVE_TEAM_QUERY_BYTES = 128 * 1024;
export const MAX_NATIVE_TEAM_QUERY_RESULT_BYTES = 32 * 1024;
const assetId = Type.String({ pattern: "^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$" });
export const NativeTeamQuerySchema = Type.Object({
  schema: Type.Literal("newmoney.team-vector-query.v1"),
  scopeKey: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  assetIds: Type.Array(assetId, { minItems: 1, maxItems: 100, uniqueItems: true }),
  vector: Type.Array(Type.Number({ minimum: -3.4028234663852886e38, maximum: 3.4028234663852886e38 }), { minItems: 4, maxItems: 4096 }),
  limit: Type.Integer({ minimum: 1, maximum: 100 })
}, { additionalProperties: false });
export const NativeTeamQueryResultSchema = Type.Object({
  schema: Type.Literal("newmoney.team-vector-result.v1"),
  hits: Type.Array(Type.Object({ assetId, score: Type.Number() }, { additionalProperties: false }), { maxItems: 100 })
}, { additionalProperties: false });
export type NativeTeamQuery = Static<typeof NativeTeamQuerySchema>;
export type NativeTeamQueryResult = Static<typeof NativeTeamQueryResultSchema>;
export function isNativeTeamQuery(value: unknown): value is NativeTeamQuery {
  return Value.Check(NativeTeamQuerySchema, value) && value.vector.length % 4 === 0 && value.vector.every(Number.isFinite);
}
export function isNativeTeamQueryResult(value: unknown): value is NativeTeamQueryResult {
  return Value.Check(NativeTeamQueryResultSchema, value) && value.hits.every(hit => Number.isFinite(hit.score))
    && new Set(value.hits.map(hit => hit.assetId)).size === value.hits.length;
}
