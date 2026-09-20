import { Type, Value, type Static } from "./typebox-schema.js";

const RequestId = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" });
const Settings = Type.Object({
  extraction: Type.Object({ provider: Type.String({ minLength: 1, maxLength: 256 }), model: Type.String({ minLength: 1, maxLength: 512 }) }, { additionalProperties: false }),
  embedding: Type.Object({ protocol: Type.Literal("openai-compatible"), endpoint: Type.String({ minLength: 1, maxLength: 2048 }),
    model: Type.String({ minLength: 1, maxLength: 128 }), dimension: Type.Integer({ minimum: 4, maximum: 4096, multipleOf: 4 }),
    apiKey: Type.String({ minLength: 1, maxLength: 4096, pattern: "^[!-~]+$" }) }, { additionalProperties: false })
}, { additionalProperties: false });

/** Secret-bearing private Main/Host channel only. Never a Renderer command/event.
 * Requesters may supply only correlation identity, never paths or credentials. */
export const TeamIndexSettingsRequestSchema = Type.Object({
  type: Type.Union([Type.Literal("team-index-settings-read"), Type.Literal("team-index-settings-cancel")]), requestId: RequestId
}, { additionalProperties: false });
export const TeamIndexSettingsMessageSchema = Type.Union([
  Type.Object({ type: Type.Literal("team-index-settings-invalidated") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("team-index-settings-result"), requestId: RequestId, ok: Type.Literal(true), settings: Settings }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("team-index-settings-result"), requestId: RequestId, ok: Type.Literal(false),
    errorCode: Type.Union([Type.Literal("UNAVAILABLE"), Type.Literal("BUSY")]) }, { additionalProperties: false })
]);
export type TeamIndexSettingsRequest = Static<typeof TeamIndexSettingsRequestSchema>;
export type TeamIndexSettingsMessage = Static<typeof TeamIndexSettingsMessageSchema>;
export type TeamIndexSettings = Static<typeof Settings>;
export function isTeamIndexSettingsRequest(value: unknown): value is TeamIndexSettingsRequest {
  return Value.Check(TeamIndexSettingsRequestSchema, value);
}
export function isTeamIndexSettingsMessage(value: unknown): value is TeamIndexSettingsMessage {
  if (!Value.Check(TeamIndexSettingsMessageSchema, value)) return false;
  if (value.type === "team-index-settings-invalidated" || !value.ok) return true;
  const { extraction, embedding } = value.settings;
  if (!extraction.provider.trim() || !extraction.model.trim() || /\p{Cc}/u.test(extraction.provider + extraction.model)
    || /[\s\p{Cc}]/u.test(embedding.model) || /[\s\p{Cc}\\?#]/u.test(embedding.endpoint)) return false;
  try { const url = new URL(embedding.endpoint); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}
