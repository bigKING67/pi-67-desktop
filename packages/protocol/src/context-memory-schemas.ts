import { Type, type TProperties, type TSchema } from "./typebox-schema.js";
import type {
  ContextMemoryCommandPayloads,
  ContextMemoryCommandResults,
  ContextMemoryEventPayloads
} from "./context-memory-messages.js";
import {
  EvidenceSchema,
  ExperienceCandidateSummarySchema,
  ExperienceResultSchema,
  ExperienceStatusSchema,
  ReviewedExperienceMethodSchema,
  SharedExperienceDetailSchema,
  SharedExperienceSearchItemSchema,
  SharedSopDetailSchema,
  SharedSopSearchItemSchema
} from "./context-memory-experience-schemas.js";

export {
  ExperienceCandidateSummarySchema,
  SharedExperienceDetailSchema,
  SharedExperienceSearchItemSchema,
  SharedSopDetailSchema,
  SharedSopSearchItemSchema
};

const IdentifierSchema = Type.String({ minLength: 1, maxLength: 512 });
const OpaqueRecallIdentifierSchema = Type.String({
  pattern: "^[a-f0-9]{64}\\.[a-f0-9]{64}$",
  minLength: 129,
  maxLength: 129
});
const TimestampSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const EndpointSchema = Type.String({ minLength: 1, maxLength: 2_048 });
const PrivacyModeSchema = Type.Union([
  Type.Literal("full-learning"),
  Type.Literal("private-learning"),
  Type.Literal("read-only"),
  Type.Literal("off")
]);
const ContextOwnerSchema = Type.Union([
  Type.Literal("pi67-openviking"),
  Type.Literal("pi-default-compaction"),
  Type.Literal("none")
]);
const MemoryScopeSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("workspace"),
  Type.Literal("team"),
  Type.Literal("company")
]);
const RecallFeedbackSchema = Type.Union([
  Type.Literal("helpful"),
  Type.Literal("irrelevant"),
  Type.Literal("outdated"),
  Type.Literal("wrong-scope"),
  Type.Literal("incorrect")
]);
const RecallRouteSchema = Type.Union([
  Type.Literal("startup-context"),
  Type.Literal("scoped-find"),
  Type.Literal("find-fast"),
  Type.Literal("session-context"),
  Type.Literal("find-fallback"),
  Type.Literal("cache"),
  Type.Literal("enterprise-experience"),
  Type.Literal("enterprise-sop")
]);

export const ContextTakeoverConfigurationSchema = strictObject({
  enabled: Type.Boolean(),
  tokenThreshold: Type.Integer({ minimum: 1_000, maximum: 1_000_000 }),
  keepRecentTurns: Type.Integer({ minimum: 1, maximum: 20 })
});

export const ContextMemoryConfigurationSchema = strictObject({
  revision: IdentifierSchema,
  enabled: Type.Boolean(),
  endpoint: EndpointSchema,
  enterpriseGatewayEndpoint: Type.String({ maxLength: 2_048 }),
  defaultPrivacyMode: PrivacyModeSchema,
  recallTokenBudget: Type.Integer({ minimum: 0, maximum: 20_000 }),
  scoreThreshold: Type.Number({ minimum: 0, maximum: 1 }),
  commitTokenThreshold: Type.Integer({ minimum: 1_000, maximum: 1_000_000 }),
  captureAssistantTurns: Type.Boolean(),
  captureToolResults: Type.Literal(false),
  actorScopeOnly: Type.Literal(true),
  privateExperienceLimit: Type.Integer({ minimum: 0, maximum: 5 }),
  localResourceRecallLimit: Type.Integer({ minimum: 0, maximum: 5 }),
  sharedExperienceLimit: Type.Integer({ minimum: 0, maximum: 5 }),
  healthTimeoutMs: Type.Integer({ minimum: 100, maximum: 10_000 }),
  recallTimeoutMs: Type.Integer({ minimum: 100, maximum: 10_000 }),
  takeover: ContextTakeoverConfigurationSchema
});

export const ContextRuntimeStatusSchema = strictObject({
  provider: Type.Literal("openviking"),
  version: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  health: Type.Union([
    Type.Literal("healthy"),
    Type.Literal("degraded"),
    Type.Literal("unavailable"),
    Type.Literal("disabled"),
    Type.Literal("conflict")
  ]),
  owner: ContextOwnerSchema,
  effectivePrivacyMode: PrivacyModeSchema,
  endpoint: EndpointSchema,
  configured: Type.Boolean(),
  conflictExtensions: Type.Array(IdentifierSchema, { maxItems: 32 }),
  lastCheckedAt: TimestampSchema,
  latencyMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 600_000 })),
  detail: Type.Optional(Type.String({ maxLength: 2_048 }))
});

export const ContextSessionStatusSchema = strictObject({
  sessionId: IdentifierSchema,
  owner: ContextOwnerSchema,
  privacyMode: PrivacyModeSchema,
  capturedTurns: Type.Integer({ minimum: 0 }),
  pendingTokens: Type.Integer({ minimum: 0 }),
  liveTailTurns: Type.Integer({ minimum: 0 }),
  takeoverActive: Type.Boolean(),
  lastCommitAt: Type.Optional(TimestampSchema)
});

export const ContextRecallItemSchema = strictObject({
  id: IdentifierSchema,
  title: Type.String({ minLength: 1, maxLength: 512 }),
  summary: Type.String({ maxLength: 8_192 }),
  source: Type.Union([
    Type.Literal("private-memory"),
    Type.Literal("private-experience"),
    Type.Literal("shared-experience"),
    Type.Literal("resource")
  ]),
  scope: MemoryScopeSchema,
  score: Type.Number({ minimum: 0, maximum: 1 }),
  createdAt: TimestampSchema,
  reason: Type.String({ minLength: 1, maxLength: 2_048 }),
  expiresAt: Type.Optional(TimestampSchema),
  workspaceId: Type.Optional(IdentifierSchema),
  route: Type.Optional(RecallRouteSchema),
  durationMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 600_000 })),
  candidateCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
  selectedCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
  feedback: Type.Optional(RecallFeedbackSchema)
});

export const MemoryEntrySummarySchema = strictObject({
  id: IdentifierSchema,
  title: Type.String({ minLength: 1, maxLength: 512 }),
  summary: Type.String({ maxLength: 8_192 }),
  scope: MemoryScopeSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  workspaceId: Type.Optional(IdentifierSchema)
});

export const MemoryDiffSummarySchema = strictObject({
  commitId: IdentifierSchema,
  added: Type.Integer({ minimum: 0 }),
  updated: Type.Integer({ minimum: 0 }),
  merged: Type.Integer({ minimum: 0 }),
  deleted: Type.Integer({ minimum: 0 }),
  committedAt: TimestampSchema
});

export const EnterpriseIdentityStatusSchema = strictObject({
  state: Type.Union([
    Type.Literal("signed-out"),
    Type.Literal("pending"),
    Type.Literal("signed-in"),
    Type.Literal("expired")
  ]),
  accountId: Type.Optional(IdentifierSchema),
  userId: Type.Optional(IdentifierSchema),
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  expiresAt: Type.Optional(TimestampSchema)
});

export const EnterpriseProjectSummarySchema = strictObject({
  id: IdentifierSchema,
  accountId: IdentifierSchema,
  name: Type.String({ minLength: 1, maxLength: 512 }),
  slug: Type.String({ minLength: 1, maxLength: 128 }),
  status: Type.Union([Type.Literal("active"), Type.Literal("archived")]),
  bindingCount: Type.Integer({ minimum: 0 }),
  candidateCount: Type.Integer({ minimum: 0 }),
  sharedAssetCount: Type.Integer({ minimum: 0 }),
  updatedAt: TimestampSchema
});

export const EnterpriseWorkspaceBindingSchema = strictObject({
  state: Type.Union([
    Type.Literal("unbound"),
    Type.Literal("pending"),
    Type.Literal("bound"),
    Type.Literal("revoked")
  ]),
  workspaceId: IdentifierSchema,
  enterpriseProjectId: Type.Optional(IdentifierSchema),
  enterpriseProjectName: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  accountId: Type.Optional(IdentifierSchema),
  boundAt: Type.Optional(TimestampSchema)
});

export const ContextAsyncOperationAcceptedSchema = strictObject({
  kind: Type.Literal("accepted"),
  operationId: IdentifierSchema,
  cancellable: Type.Literal(false)
});

export const ContextMemoryCommandPayloadSchemas: Record<keyof ContextMemoryCommandPayloads, TSchema> = {
  "context.status.get": strictObject({}),
  "context.config.get": strictObject({}),
  "context.config.update": strictObject({
    expectedRevision: IdentifierSchema,
    enabled: Type.Boolean(),
    endpoint: EndpointSchema,
    enterpriseGatewayEndpoint: Type.String({ maxLength: 2_048 }),
    defaultPrivacyMode: PrivacyModeSchema,
    recallTokenBudget: Type.Integer({ minimum: 0, maximum: 20_000 }),
    scoreThreshold: Type.Number({ minimum: 0, maximum: 1 }),
    commitTokenThreshold: Type.Integer({ minimum: 1_000, maximum: 1_000_000 }),
    captureAssistantTurns: Type.Boolean(),
    privateExperienceLimit: Type.Integer({ minimum: 0, maximum: 5 }),
    localResourceRecallLimit: Type.Integer({ minimum: 0, maximum: 5 }),
    sharedExperienceLimit: Type.Integer({ minimum: 0, maximum: 5 }),
    takeover: ContextTakeoverConfigurationSchema
  }),
  "context.runtime.doctor": strictObject({ probeRemote: Type.Optional(Type.Boolean()) }),
  "context.session.get": strictObject({ sessionId: IdentifierSchema }),
  "context.session.commit": strictObject({ submissionId: IdentifierSchema, sessionId: IdentifierSchema }),
  "context.recall.list": strictObject({
    sessionId: Type.Optional(IdentifierSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
  }),
  "context.recall.feedback": strictObject({
    id: OpaqueRecallIdentifierSchema,
    feedback: RecallFeedbackSchema,
    sessionId: Type.Optional(IdentifierSchema)
  }),
  "context.recall.metrics": strictObject({}),
  "memory.search": strictObject({
    query: Type.String({ minLength: 1, maxLength: 2_048 }),
    scope: Type.Optional(MemoryScopeSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
  }),
  "memory.get": strictObject({ id: IdentifierSchema }),
  "memory.forget.preview": strictObject({ id: IdentifierSchema }),
  "memory.forget.confirm": strictObject({ submissionId: IdentifierSchema, previewToken: IdentifierSchema }),
  "experience.private.list": strictObject({
    status: Type.Optional(ExperienceStatusSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
  }),
  "experience.candidate.get": strictObject({ id: IdentifierSchema }),
  "experience.candidate.review": strictObject({
    id: IdentifierSchema,
    expectedUpdatedAt: TimestampSchema,
    taskType: Type.String({ minLength: 1, maxLength: 256 }),
    title: Type.String({ minLength: 1, maxLength: 512 }),
    problem: Type.String({ minLength: 1, maxLength: 8_192 }),
    strategy: Type.String({ minLength: 1, maxLength: 16_384 }),
    result: ExperienceResultSchema,
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    sensitivity: Type.Union([
      Type.Literal("project"),
      Type.Literal("team"),
      Type.Literal("company")
    ]),
    method: ReviewedExperienceMethodSchema,
    applicableWhen: Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { minItems: 1, maxItems: 64 }),
    notApplicableWhen: Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { minItems: 1, maxItems: 64 }),
    evidence: Type.Array(EvidenceSchema, { maxItems: 64 }),
    confirmOutcome: Type.Literal(true),
    confirmRedaction: Type.Literal(true)
  }),
  "experience.candidate.promote": strictObject({ submissionId: IdentifierSchema, id: IdentifierSchema }),
  "experience.candidate.reject": strictObject({
    id: IdentifierSchema,
    reason: Type.String({ minLength: 1, maxLength: 2_048 })
  }),
  "experience.shared.search": strictObject({
    query: Type.String({ minLength: 1, maxLength: 2_048 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 }))
  }),
  "experience.shared.get": strictObject({ id: IdentifierSchema }),
  "sop.shared.search": strictObject({
    query: Type.String({ minLength: 1, maxLength: 2_048 })
  }),
  "sop.shared.get": strictObject({ id: IdentifierSchema }),
  "enterprise.identity.get": strictObject({}),
  "enterprise.auth.begin": strictObject({}),
  "enterprise.auth.poll": strictObject({ authorizationId: IdentifierSchema }),
  "enterprise.auth.disconnect": strictObject({}),
  "enterprise.project.list": strictObject({}),
  "enterprise.workspace.get": strictObject({}),
  "enterprise.workspace.bind": strictObject({ enterpriseProjectId: IdentifierSchema }),
  "enterprise.workspace.unbind": strictObject({})
};

export const ContextDoctorResultSchema = strictObject({
  checkedAt: TimestampSchema,
  status: ContextRuntimeStatusSchema,
  effectiveConfiguration: ContextMemoryConfigurationSchema,
  checks: Type.Array(strictObject({
    id: IdentifierSchema,
    status: Type.Union([Type.Literal("pass"), Type.Literal("warn"), Type.Literal("fail")]),
    detail: Type.String({ maxLength: 2_048 })
  }), { maxItems: 64 })
});

export const ContextMemoryCommandResultSchemas: Record<keyof ContextMemoryCommandResults, TSchema> = {
  "context.status.get": ContextRuntimeStatusSchema,
  "context.config.get": ContextMemoryConfigurationSchema,
  "context.config.update": ContextMemoryConfigurationSchema,
  "context.runtime.doctor": ContextDoctorResultSchema,
  "context.session.get": ContextSessionStatusSchema,
  "context.session.commit": ContextAsyncOperationAcceptedSchema,
  "context.recall.list": strictObject({ items: Type.Array(ContextRecallItemSchema), total: Type.Integer({ minimum: 0 }) }),
  "context.recall.feedback": strictObject({
    id: OpaqueRecallIdentifierSchema,
    feedback: RecallFeedbackSchema,
    recordedAt: TimestampSchema
  }),
  "context.recall.metrics": strictObject({
    sampleCount: Type.Integer({ minimum: 0, maximum: 500 }),
    p50Ms: Type.Integer({ minimum: 0, maximum: 600_000 }),
    p95Ms: Type.Integer({ minimum: 0, maximum: 600_000 }),
    fastPathRate: Type.Number({ minimum: 0, maximum: 1 }),
    expansionRate: Type.Number({ minimum: 0, maximum: 1 }),
    cacheHitRate: Type.Number({ minimum: 0, maximum: 1 }),
    emptyRate: Type.Number({ minimum: 0, maximum: 1 }),
    targetP95Ms: Type.Integer({ minimum: 1, maximum: 600_000 }),
    withinTarget: Type.Boolean()
  }),
  "memory.search": strictObject({ items: Type.Array(MemoryEntrySummarySchema), total: Type.Integer({ minimum: 0 }) }),
  "memory.get": MemoryEntrySummarySchema,
  "memory.forget.preview": strictObject({
    previewToken: IdentifierSchema,
    entry: MemoryEntrySummarySchema,
    effects: Type.Array(Type.String({ maxLength: 2_048 }), { maxItems: 64 }),
    expiresAt: TimestampSchema
  }),
  "memory.forget.confirm": ContextAsyncOperationAcceptedSchema,
  "experience.private.list": strictObject({ items: Type.Array(ExperienceCandidateSummarySchema), total: Type.Integer({ minimum: 0 }) }),
  "experience.candidate.get": ExperienceCandidateSummarySchema,
  "experience.candidate.review": ExperienceCandidateSummarySchema,
  "experience.candidate.promote": ContextAsyncOperationAcceptedSchema,
  "experience.candidate.reject": ExperienceCandidateSummarySchema,
  "experience.shared.search": strictObject({ items: Type.Array(SharedExperienceSearchItemSchema), total: Type.Integer({ minimum: 0 }) }),
  "experience.shared.get": SharedExperienceDetailSchema,
  "sop.shared.search": strictObject({ items: Type.Array(SharedSopSearchItemSchema, { maxItems: 1 }), total: Type.Integer({ minimum: 0, maximum: 1 }) }),
  "sop.shared.get": SharedSopDetailSchema,
  "enterprise.identity.get": EnterpriseIdentityStatusSchema,
  "enterprise.auth.begin": strictObject({
    authorizationId: IdentifierSchema,
    verificationUri: EndpointSchema,
    userCode: Type.String({ minLength: 1, maxLength: 64 }),
    expiresAt: TimestampSchema,
    intervalSeconds: Type.Integer({ minimum: 1, maximum: 300 })
  }),
  "enterprise.auth.poll": EnterpriseIdentityStatusSchema,
  "enterprise.auth.disconnect": EnterpriseIdentityStatusSchema,
  "enterprise.project.list": strictObject({
    items: Type.Array(EnterpriseProjectSummarySchema, { maxItems: 1_000 }),
    total: Type.Integer({ minimum: 0 })
  }),
  "enterprise.workspace.get": EnterpriseWorkspaceBindingSchema,
  "enterprise.workspace.bind": EnterpriseWorkspaceBindingSchema,
  "enterprise.workspace.unbind": EnterpriseWorkspaceBindingSchema
};

export const ContextMemoryEventPayloadSchemas: Record<keyof ContextMemoryEventPayloads, TSchema> = {
  "context.healthChanged": ContextRuntimeStatusSchema,
  "context.ownerLocked": strictObject({ sessionId: IdentifierSchema, owner: ContextOwnerSchema, lockedAt: TimestampSchema }),
  "context.configChanged": ContextMemoryConfigurationSchema,
  "context.recallStarted": strictObject({ sessionId: IdentifierSchema, startedAt: TimestampSchema }),
  "context.recallCompleted": strictObject({ sessionId: IdentifierSchema, completedAt: TimestampSchema, count: Type.Integer({ minimum: 0 }), degraded: Type.Boolean() }),
  "context.captureQueued": strictObject({ sessionId: IdentifierSchema, turnId: IdentifierSchema, queuedAt: TimestampSchema }),
  "context.captureFailed": strictObject({ sessionId: IdentifierSchema, turnId: IdentifierSchema, failedAt: TimestampSchema, detail: Type.String({ maxLength: 2_048 }) }),
  "context.commitCompleted": strictObject({ operationId: IdentifierSchema, sessionId: IdentifierSchema, diff: Type.Optional(MemoryDiffSummarySchema) }),
  "context.commitFailed": strictObject({ operationId: IdentifierSchema, sessionId: IdentifierSchema, detail: Type.String({ maxLength: 2_048 }) }),
  "memory.diffAvailable": MemoryDiffSummarySchema,
  "memory.forgetCompleted": strictObject({ operationId: IdentifierSchema, memoryId: IdentifierSchema, completedAt: TimestampSchema }),
  "experience.candidateCreated": ExperienceCandidateSummarySchema,
  "experience.candidateAssemblyFailed": strictObject({
    sourceSessionIdHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    failedAt: TimestampSchema,
    detail: Type.String({ maxLength: 2_048 })
  }),
  "experience.candidateValidated": ExperienceCandidateSummarySchema,
  "experience.candidatePromoted": strictObject({ operationId: IdentifierSchema, candidate: ExperienceCandidateSummarySchema }),
  "experience.candidatePromotionFailed": strictObject({
    operationId: IdentifierSchema,
    candidateId: IdentifierSchema,
    failedAt: TimestampSchema,
    detail: Type.String({ maxLength: 2_048 })
  }),
  "experience.candidateRejected": ExperienceCandidateSummarySchema,
  "enterprise.authChanged": EnterpriseIdentityStatusSchema,
  "enterprise.workspaceBindingChanged": EnterpriseWorkspaceBindingSchema
};

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
