import { Type, Value, type Static } from "./typebox-schema.js";

const RequestId = Type.String({ minLength: 1, maxLength: 128 });
export const LocalMemoryConnectRequestSchema = Type.Object({
  type: Type.Literal("local-memory-connect"), requestId: RequestId,
  start: Type.Optional(Type.Literal(false))
}, { additionalProperties: false });

const Connection = Type.Object({
  endpoint: Type.String({ pattern: "^http://127\\.0\\.0\\.1:[1-9][0-9]{0,4}$" }),
  apiKey: Type.String({ minLength: 1, maxLength: 4_096 }),
  localProfileId: Type.String({ minLength: 1, maxLength: 128 }),
  account: Type.String({ minLength: 1, maxLength: 128 }),
  user: Type.String({ minLength: 1, maxLength: 128 })
}, { additionalProperties: false });

export const LocalMemoryConnectResultSchema = Type.Union([
  Type.Object({ type: Type.Literal("local-memory-connect-result"), requestId: RequestId,
    ok: Type.Literal(true), connection: Connection }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("local-memory-connect-result"), requestId: RequestId,
    ok: Type.Literal(false), errorCode: Type.Union([
      Type.Literal("NOT_CONFIGURED"), Type.Literal("RUNTIME_UNAVAILABLE"), Type.Literal("STOPPING")
    ]) }, { additionalProperties: false })
]);

export type LocalMemoryConnectRequest = Static<typeof LocalMemoryConnectRequestSchema>;
export type LocalMemoryConnectResult = Static<typeof LocalMemoryConnectResultSchema>;
export type LocalMemoryConnection = Static<typeof Connection>;

export function isLocalMemoryConnectRequest(value: unknown): value is LocalMemoryConnectRequest {
  return Value.Check(LocalMemoryConnectRequestSchema, value);
}

export function isLocalMemoryConnectResult(value: unknown): value is LocalMemoryConnectResult {
  if (!Value.Check(LocalMemoryConnectResultSchema, value)) return false;
  if (!value.ok) return true;
  const port = Number(value.connection.endpoint.split(":").at(-1));
  return Number.isInteger(port) && port > 0 && port <= 65_535;
}
