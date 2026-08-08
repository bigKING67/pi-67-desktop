import { Type } from "./typebox-schema.js";

export const SessionInteractionModeSchema = Type.Union([
  Type.Literal("execute"),
  Type.Literal("plan")
]);

export const ActiveProposedPlanSchema = Type.Object({
  planId: Type.String({ minLength: 1, maxLength: 128 }),
  sourceOperationId: Type.String({ minLength: 1, maxLength: 512 }),
  markdown: Type.String({ minLength: 1, maxLength: 200_000 }),
  createdAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
}, { additionalProperties: false });
