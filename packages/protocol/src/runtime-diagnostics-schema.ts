import { Type, type TProperties } from "./typebox-schema.js";
import { SessionCatalogStatusSchema } from "./session-catalog-schemas.js";

export const RuntimeDiagnosticsSchema = strictObject({
  generatedAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  application: Type.String({ minLength: 1, maxLength: 64 }),
  piSdkVersion: Type.String({ minLength: 1, maxLength: 128 }),
  platform: Type.String({ minLength: 1, maxLength: 64 }),
  architecture: Type.String({ minLength: 1, maxLength: 64 }),
  node: Type.String({ minLength: 1, maxLength: 128 }),
  workspace: Type.Optional(strictObject({
    pathHash: Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]+$" }),
    pathKind: Type.Union([Type.Literal("drive"), Type.Literal("unc"), Type.Literal("posix")])
  })),
  sessionConfigured: Type.Boolean(),
  sessionFileConfigured: Type.Boolean(),
  model: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  extensionCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  extensionErrors: Type.Array(strictObject({
    sourceHash: Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]+$" }),
    errorClass: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Z0-9_]+$" })
  }), { maxItems: 64 }),
  toolExecutionReceiptFailureCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  host: Type.Optional(strictObject({
    hostEpoch: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    taskCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    liveRuntimeCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    activeOperationCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    scheduler: strictObject({
      taskCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      activeQueryCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      queuedControlCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      runningControlCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      queuedPromptCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      runningPromptCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      turnAdmissionCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      closedCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
    }),
    operations: strictObject({
      registryCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      acceptingCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      activeCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      terminatingCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      poisonedCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      heartbeatTrackedCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      maxQuietForMs: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
    }),
    writerLeases: strictObject({
      activeCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      pendingCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      compromised: Type.Boolean()
    }),
    initializationReceipts: Type.Optional(strictObject({
      receipts: Type.Array(strictObject({
        outcome: Type.Union([
          Type.Literal("in-progress"),
          Type.Literal("completed"),
          Type.Literal("failed")
        ]),
        stages: Type.Array(strictObject({
          stage: Type.Union([
            Type.Literal("resolve-session"),
            Type.Literal("dispose-current"),
            Type.Literal("create-session"),
            Type.Literal("load-model-runtime"),
            Type.Literal("validate-packages"),
            Type.Literal("load-session-resources"),
            Type.Literal("activate-session"),
            Type.Literal("reload-configuration"),
            Type.Literal("project-snapshot")
          ]),
          outcome: Type.Union([
            Type.Literal("started"),
            Type.Literal("completed"),
            Type.Literal("failed")
          ]),
          durationMs: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
        }), { maxItems: 32 }),
        stagesTruncated: Type.Boolean()
      }), { maxItems: 64 }),
      receiptsTruncated: Type.Boolean()
    })),
    workspaces: Type.Array(strictObject({
      workspaceIdHash: Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]+$" }),
      sessionCatalog: SessionCatalogStatusSchema,
      sessionCreationJournal: strictObject({
        entryCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        stateCounts: strictObject({
          reserved: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
          materializing: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
          materialized: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
          published: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
          acknowledged: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
          ambiguous: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
          abandoned: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
        }),
        invalidEntryCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        truncated: Type.Boolean()
      })
    }), { maxItems: 64 }),
    workspacesTruncated: Type.Boolean()
  }))
});

const RuntimeDiagnosticsCollectionFailureSchema = Type.Union([
  Type.Literal("acknowledgement-timeout"),
  Type.Literal("connection-unavailable"),
  Type.Literal("host-replaced"),
  Type.Literal("protocol-error"),
  Type.Literal("unknown")
]);

const RendererAcknowledgementDiagnosticsSchema = strictObject({
  activeRequestCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  sampleCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  slowAcknowledgementCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  slowThresholdMs: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  lastAcknowledgementLatencyMs: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  maxAcknowledgementLatencyMs: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  connectionGeneration: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  teardownCount: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  futureGenerationWaitCount: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  futureGenerationWaitTimeoutCount: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  priorGenerationTeardownIgnoredCount: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  lastTeardownAt: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  lastTeardownCode: Type.Optional(Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Z][A-Z0-9_]*$" })),
  lastTeardownReason: Type.Optional(Type.Union([
    Type.Literal("port-closed"),
    Type.Literal("message-decode-failed"),
    Type.Literal("handshake-timeout"),
    Type.Literal("handshake-send-failed"),
    Type.Literal("handshake-rejected"),
    Type.Literal("handshake-identity-mismatch"),
    Type.Literal("protocol-violation"),
    Type.Literal("request-send-failed"),
    Type.Literal("request-cancellation-send-failed"),
    Type.Literal("disposed")
  ]))
});

export const SupportDiagnosticsExportRequestSchema = Type.Union([
  strictObject({
    runtimeCollection: strictObject({ status: Type.Literal("available") }),
    runtime: RuntimeDiagnosticsSchema,
    renderer: RendererAcknowledgementDiagnosticsSchema
  }),
  strictObject({
    runtimeCollection: strictObject({
      status: Type.Literal("unavailable"),
      failure: RuntimeDiagnosticsCollectionFailureSchema
    }),
    renderer: RendererAcknowledgementDiagnosticsSchema
  })
]);

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
