import { Type, Value, type Static } from "./typebox-schema.js";

// Capability transfer metadata only: never accepts identity, model selection or bytes.
export const TeamModelPortAttachSchema = Type.Object({
  type: Type.Literal("team-model-port-attach"),
  requestId: Type.String({ format: "uuid" })
}, { additionalProperties: false });
export type TeamModelPortAttach = Static<typeof TeamModelPortAttachSchema>;
export function isTeamModelPortAttach(value: unknown): value is TeamModelPortAttach {
  return Value.Check(TeamModelPortAttachSchema, value);
}
