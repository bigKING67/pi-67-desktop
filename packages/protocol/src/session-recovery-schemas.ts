import { strictObject, Type } from "./typebox-schema.js";

export const SessionRecoveryAnchorSchema = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" });
export const SessionRecoveryViewSchema = Type.Union([
  strictObject({ status: Type.Literal("none") }),
  strictObject({ status: Type.Literal("available"), anchor: SessionRecoveryAnchorSchema }),
  strictObject({
    status: Type.Literal("blocked"),
    reason: Type.Union([Type.Literal("unconfirmed-tools"), Type.Literal("auto-selection-missing"), Type.Literal("history-limit")]),
    pendingToolCount: Type.Integer({ minimum: 0, maximum: 1_000_000 })
  })
]);
