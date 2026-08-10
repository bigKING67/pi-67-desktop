import { MAX_SESSION_FILE_IDENTITY_CHARS } from "@pi67/domain";
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

const PlanImplementationLineageProperties = {
  planId: Type.String({ minLength: 1, maxLength: 128 }),
  sourceOperationId: Type.String({ minLength: 1, maxLength: 512 }),
  submissionId: Type.String({ minLength: 1, maxLength: 512 }),
  operationId: Type.String({ minLength: 1, maxLength: 512 }),
  hostEpoch: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  sessionId: Type.String({ minLength: 1, maxLength: 512 }),
  sessionFileIdentity: Type.String({
    minLength: 1,
    maxLength: MAX_SESSION_FILE_IDENTITY_CHARS
  }),
  sessionGeneration: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  timestamp: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
};

export const PlanLifecycleChangeSchema = Type.Union([
  Type.Object({
    phase: Type.Literal("dismissed"),
    planId: Type.String({ minLength: 1, maxLength: 128 }),
    timestamp: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  }, { additionalProperties: false }),
  Type.Object({
    phase: Type.Union([
      Type.Literal("implementation-requested"),
      Type.Literal("implementation-started"),
      Type.Literal("implementation-start-failed")
    ]),
    ...PlanImplementationLineageProperties
  }, { additionalProperties: false })
]);
