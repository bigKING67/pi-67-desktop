import {
  MAX_USAGE_REPORT_BUCKETS,
  MAX_USAGE_REPORT_MODELS
} from "@pi67/domain";
import { Type, type TProperties } from "./typebox-schema.js";

const UsageWindowSchema = Type.Union([
  Type.Literal("7d"),
  Type.Literal("30d"),
  Type.Literal("90d")
]);

export const WorkspaceUsageReportPayloadSchema = strictObject({ window: UsageWindowSchema });

const UsageTotalsSchema = strictObject({
  input: Type.Number({ minimum: 0 }),
  output: Type.Number({ minimum: 0 }),
  cacheRead: Type.Number({ minimum: 0 }),
  cacheWrite: Type.Number({ minimum: 0 }),
  total: Type.Number({ minimum: 0 }),
  recordedCost: Type.Optional(Type.Number({ minimum: 0 }))
});

export const WorkspaceUsageReportSchema = strictObject({
  workspaceId: Type.String({ minLength: 1, maxLength: 512 }),
  generatedAt: Type.Integer({ minimum: 0 }),
  window: UsageWindowSchema,
  buckets: Type.Array(strictObject({
    date: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
    provider: Type.String({ minLength: 1, maxLength: 128 }),
    model: Type.String({ minLength: 1, maxLength: 128 }),
    source: Type.Union([
      Type.Literal("assistant-message"),
      Type.Literal("tool-result"),
      Type.Literal("compaction"),
      Type.Literal("branch-summary")
    ]),
    sessions: Type.Integer({ minimum: 0 }),
    turns: Type.Integer({ minimum: 0 }),
    totals: UsageTotalsSchema
  }), { maxItems: MAX_USAGE_REPORT_BUCKETS }),
  models: Type.Array(strictObject({
    provider: Type.String({ minLength: 1, maxLength: 128 }),
    model: Type.String({ minLength: 1, maxLength: 128 }),
    sessions: Type.Integer({ minimum: 0 }),
    turns: Type.Integer({ minimum: 0 }),
    totals: UsageTotalsSchema
  }), { maxItems: MAX_USAGE_REPORT_MODELS }),
  totals: UsageTotalsSchema,
  coverage: strictObject({
    discoveredSessions: Type.Integer({ minimum: 0 }),
    scannedSessions: Type.Integer({ minimum: 0 }),
    skippedSessions: Type.Integer({ minimum: 0 }),
    unavailableSessions: Type.Integer({ minimum: 0 }),
    invalidSessions: Type.Integer({ minimum: 0 }),
    futureVersionSessions: Type.Integer({ minimum: 0 }),
    undatedUsageEntries: Type.Integer({ minimum: 0 }),
    complete: Type.Boolean()
  })
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
