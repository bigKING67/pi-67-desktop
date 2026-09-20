import { Type, Value, type Static } from "./typebox-schema.js";

const strict = { additionalProperties: false };
const text = (maxLength: number) => Type.String({ minLength: 1, maxLength, pattern: "^(?![\\s\\S]*\\u0000)(?=[\\s\\S]*\\S)[\\s\\S]+$" });
const extraction = Type.Object({ provider: text(256), model: text(512) }, strict);
const embedding = { protocol: Type.Literal("openai-compatible"), endpoint: text(2048),
  model: text(512), dimension: Type.Integer({ minimum: 1, maximum: 65536 }) };
export const LocalMemorySettingsRequestSchema = Type.Object({ extraction, embedding: Type.Object({ ...embedding,
  apiKey: Type.Union([Type.Object({ action: Type.Literal("keep") }, strict),
    Type.Object({ action: Type.Literal("replace"), value: text(4096) }, strict)])
}, strict) }, strict);
export const LocalMemorySettingsSnapshotSchema = Type.Union([
  Type.Object({ status: Type.Literal("unavailable") }, strict),
  Type.Object({ status: Type.Literal("unconfigured") }, strict),
  Type.Object({ status: Type.Literal("configured"), extraction,
    embedding: Type.Object({ ...embedding, hasApiKey: Type.Literal(true) }, strict), appliesOn: Type.Literal("next-start") }, strict)
]);
export type LocalMemorySettingsRequest = Static<typeof LocalMemorySettingsRequestSchema>;
export type LocalMemorySettingsSnapshot = Static<typeof LocalMemorySettingsSnapshotSchema>;
export const LocalMemoryKeyRevealRequestSchema = Type.Object({ endpoint: text(2048) }, strict);
export const LocalMemoryKeyRevealResultSchema = text(4096);
export interface LocalMemorySettingsBridge {
  get(): Promise<LocalMemorySettingsSnapshot>;
  save(value: LocalMemorySettingsRequest): Promise<LocalMemorySettingsSnapshot>;
  revealKey(value: { endpoint: string }): Promise<string>;
}
export function parseLocalMemoryKeyRevealRequest(value: unknown): { endpoint: string } | undefined {
  return Value.Check(LocalMemoryKeyRevealRequestSchema, value) && validEndpoint(value.endpoint) ? { endpoint: value.endpoint } : undefined;
}
export function parseLocalMemorySettingsRequest(value: unknown): LocalMemorySettingsRequest | undefined {
  return Value.Check(LocalMemorySettingsRequestSchema, value) && validEndpoint(value.embedding.endpoint) ? structuredClone(value) : undefined;
}
export function isLocalMemorySettingsSnapshot(value: unknown): value is LocalMemorySettingsSnapshot {
  return Value.Check(LocalMemorySettingsSnapshotSchema, value)
    && (value.status !== "configured" || validEndpoint(value.embedding.endpoint));
}
function validEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch { return false; }
}
