import { Type, Value, type Static } from "./typebox-schema.js";

export const EnterprisePowerTransitionMessageSchema = Type.Object({
  type: Type.Literal("enterprise-power-transition"),
  state: Type.Union([Type.Literal("suspend"), Type.Literal("resume")])
}, { additionalProperties: false });
export type EnterprisePowerTransitionMessage = Static<typeof EnterprisePowerTransitionMessageSchema>;
export function isEnterprisePowerTransitionMessage(value: unknown): value is EnterprisePowerTransitionMessage {
  return Value.Check(EnterprisePowerTransitionMessageSchema, value);
}
