import { Type, Value, type Static } from "./typebox-schema.js";

const RequestId = Type.String({ minLength: 1, maxLength: 128 });
export const LocalMemoryModelRequestSchema = Type.Object({
  type: Type.Literal("local-memory-extraction-resolve"), requestId: RequestId,
  selection: Type.Object({ provider: Type.String({ minLength: 1, maxLength: 256 }),
    model: Type.String({ minLength: 1, maxLength: 512 }) }, { additionalProperties: false })
}, { additionalProperties: false });
export const LocalMemoryModelCancelSchema = Type.Object({
  type: Type.Literal("local-memory-extraction-cancel"), requestId: RequestId
}, { additionalProperties: false });
const Model = Type.Object({ protocol: Type.Literal("openai-compatible"),
  endpoint: Type.String({ minLength: 1, maxLength: 2_048 }),
  model: Type.String({ minLength: 1, maxLength: 512 }), apiKey: Type.String({ minLength: 1, maxLength: 4_096 })
}, { additionalProperties: false });
export const LocalMemoryModelResultSchema = Type.Union([
  Type.Object({ type: Type.Literal("local-memory-extraction-result"), requestId: RequestId,
    ok: Type.Literal(true), model: Model }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("local-memory-extraction-result"), requestId: RequestId,
    ok: Type.Literal(false), errorCode: Type.Union([Type.Literal("UNAVAILABLE"), Type.Literal("BUSY")])
  }, { additionalProperties: false })
]);
export type LocalMemoryModelRequest = Static<typeof LocalMemoryModelRequestSchema>;
export type LocalMemoryModelCancel = Static<typeof LocalMemoryModelCancelSchema>;
export type LocalMemoryModelResult = Static<typeof LocalMemoryModelResultSchema>;
export type LocalMemoryResolvedModel = Static<typeof Model>;
export function isLocalMemoryModelRequest(value: unknown): value is LocalMemoryModelRequest {
  return Value.Check(LocalMemoryModelRequestSchema, value);
}
export function isLocalMemoryModelCancel(value: unknown): value is LocalMemoryModelCancel {
  return Value.Check(LocalMemoryModelCancelSchema, value);
}
export function isLocalMemoryModelResult(value: unknown): value is LocalMemoryModelResult {
  if (!Value.Check(LocalMemoryModelResultSchema, value)) return false;
  if (!value.ok) return true;
  try {
    const endpoint = new URL(value.model.endpoint);
    return !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash
      && (endpoint.protocol === "https:" || (endpoint.protocol === "http:"
        && ["127.0.0.1", "[::1]"].includes(endpoint.hostname)));
  } catch { return false; }
}
