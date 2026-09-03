import { Type, type TProperties } from "./typebox-schema.js";

const IdentifierSchema = Type.String({ minLength: 1, maxLength: 512 });
const TimestampSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });

export const ExperienceStatusSchema = Type.Union([
  Type.Literal("private"),
  Type.Literal("candidate"),
  Type.Literal("submitted"),
  Type.Literal("validated"),
  Type.Literal("shared"),
  Type.Literal("rejected"),
  Type.Literal("revoked")
]);

export const ExperienceResultSchema = Type.Union([
  Type.Literal("success"),
  Type.Literal("partial"),
  Type.Literal("failed"),
  Type.Literal("rolled-back")
]);

export const EvidenceSchema = strictObject({
  kind: Type.Union([
    Type.Literal("test"),
    Type.Literal("tool-result"),
    Type.Literal("user-confirmation"),
    Type.Literal("artifact")
  ]),
  label: Type.String({ minLength: 1, maxLength: 512 }),
  reference: Type.String({ minLength: 1, maxLength: 2_048 }),
  verifiedAt: TimestampSchema
});

const ExperienceSourceCaseSchema = strictObject({
  id: IdentifierSchema,
  source: Type.Literal("pi-session-commit"),
  result: ExperienceResultSchema,
  evidenceCount: Type.Integer({ minimum: 0, maximum: 64 }),
  workspaceId: IdentifierSchema,
  capturedAt: TimestampSchema
});

const ExperienceMethodSchema = strictObject({
  preconditions: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 32 }),
  steps: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 32 }),
  tools: Type.Array(Type.String({ maxLength: 512 }), { maxItems: 32 }),
  validationGates: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 32 }),
  completionCriteria: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 32 }),
  failureModes: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 32 }),
  rollback: Type.String({ maxLength: 8_192 })
});

export const ReviewedExperienceMethodSchema = strictObject({
  preconditions: Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { minItems: 1, maxItems: 32 }),
  steps: Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { minItems: 1, maxItems: 32 }),
  tools: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 32 }),
  validationGates: Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { minItems: 1, maxItems: 32 }),
  completionCriteria: Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { minItems: 1, maxItems: 32 }),
  failureModes: Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { minItems: 1, maxItems: 32 }),
  rollback: Type.String({ minLength: 1, maxLength: 8_192 })
});

export const ExperienceCandidateSummarySchema = strictObject({
  id: IdentifierSchema,
  taskType: Type.String({ minLength: 1, maxLength: 256 }),
  title: Type.String({ minLength: 1, maxLength: 512 }),
  problem: Type.String({ minLength: 1, maxLength: 8_192 }),
  strategy: Type.String({ minLength: 1, maxLength: 16_384 }),
  result: ExperienceResultSchema,
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  status: ExperienceStatusSchema,
  sensitivity: Type.Union([
    Type.Literal("private"),
    Type.Literal("project"),
    Type.Literal("team"),
    Type.Literal("company")
  ]),
  sourceCases: Type.Array(ExperienceSourceCaseSchema, { maxItems: 64 }),
  method: ExperienceMethodSchema,
  applicableWhen: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 64 }),
  notApplicableWhen: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 64 }),
  evidence: Type.Array(EvidenceSchema, { maxItems: 64 }),
  redactionStatus: Type.Union([Type.Literal("pending"), Type.Literal("passed"), Type.Literal("failed")]),
  workspaceId: IdentifierSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  enterpriseCandidateId: Type.Optional(IdentifierSchema),
  submittedAt: Type.Optional(TimestampSchema)
});

export const SharedExperienceSearchItemSchema = strictObject({
  id: IdentifierSchema,
  projectId: IdentifierSchema,
  title: Type.String({ minLength: 1, maxLength: 512 }),
  taskType: Type.String({ minLength: 1, maxLength: 256 }),
  summary: Type.String({ maxLength: 8_192 }),
  score: Type.Number({ minimum: 0, maximum: 1 }),
  applicableWhen: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 64 }),
  notApplicableWhen: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 64 }),
  externalRevision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  publishedAt: TimestampSchema
});

export const SharedExperienceDetailSchema = strictObject({
  id: IdentifierSchema,
  projectId: IdentifierSchema,
  title: Type.String({ minLength: 1, maxLength: 512 }),
  taskType: Type.String({ minLength: 1, maxLength: 256 }),
  problem: Type.String({ minLength: 1, maxLength: 8_192 }),
  strategy: Type.String({ minLength: 1, maxLength: 16_384 }),
  method: Type.Optional(ExperienceMethodSchema),
  result: ExperienceResultSchema,
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  sensitivity: Type.Union([Type.Literal("project"), Type.Literal("team"), Type.Literal("company")]),
  applicableWhen: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 64 }),
  notApplicableWhen: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 64 }),
  evidence: Type.Array(EvidenceSchema, { maxItems: 64 }),
  externalRevision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  publishedAt: TimestampSchema
});

export const SharedSopSearchItemSchema = strictObject({
  id: IdentifierSchema,
  projectId: IdentifierSchema,
  stableKey: Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 256 }),
  semanticVersion: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1, maxLength: 512 }),
  taskType: Type.String({ minLength: 1, maxLength: 256 }),
  summary: Type.String({ maxLength: 8_192 }),
  score: Type.Number({ minimum: 0, maximum: 1 }),
  applicableWhen: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 64 }),
  notApplicableWhen: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 64 }),
  expiresAt: Type.Optional(TimestampSchema),
  externalRevision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  publishedAt: TimestampSchema
});

export const SharedSopDetailSchema = strictObject({
  id: IdentifierSchema,
  projectId: IdentifierSchema,
  stableKey: Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 256 }),
  semanticVersion: Type.Integer({ minimum: 1 }),
  ownerUserIdHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  title: Type.String({ minLength: 1, maxLength: 512 }),
  taskType: Type.String({ minLength: 1, maxLength: 256 }),
  problem: Type.String({ minLength: 1, maxLength: 8_192 }),
  strategy: Type.String({ minLength: 1, maxLength: 16_384 }),
  method: ExperienceMethodSchema,
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  sensitivity: Type.Union([Type.Literal("project"), Type.Literal("team"), Type.Literal("company")]),
  applicableWhen: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 64 }),
  notApplicableWhen: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 64 }),
  evidence: Type.Array(EvidenceSchema, { maxItems: 64 }),
  expiresAt: Type.Optional(TimestampSchema),
  externalRevision: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  publishedAt: TimestampSchema
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
