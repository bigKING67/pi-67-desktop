import { Type, Value, type Static } from "./typebox-schema.js";

export const NATIVE_TEAM_MODEL_MAX_FRAME = 3 * 1024 * 1024;
export const NATIVE_TEAM_MODEL_MAX_BODY = 2 * 1024 * 1024;
export const NativeTeamModelRequestSchema = Type.Object({
  type: Type.Literal("team-model-request"),
  requestId: Type.String({ pattern: "^[a-f0-9]{32}$" }),
  purpose: Type.Union([Type.Literal("embedding"), Type.Literal("extraction")]),
  endpoint: Type.String({ minLength: 1, maxLength: 2048 }),
  model: Type.String({ minLength: 1, maxLength: 128 }),
  body: Type.String({ minLength: 4, maxLength: 2_796_204, pattern: "^[A-Za-z0-9+/]*={0,2}$" })
}, { additionalProperties: false });
export type NativeTeamModelRequest = Static<typeof NativeTeamModelRequestSchema>;
export function isNativeTeamModelRequest(value: unknown): value is NativeTeamModelRequest {
  return Value.Check(NativeTeamModelRequestSchema, value);
}
