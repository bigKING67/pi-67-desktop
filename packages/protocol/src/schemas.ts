import { Type, type TProperties, type TSchema } from "./typebox-schema.js";
import {
  MAX_SLASH_COMMAND_DESCRIPTION_CHARS,
  MAX_SLASH_COMMAND_ITEMS,
  MAX_SLASH_COMMAND_NAME_CHARS,
  MAX_SESSION_FILE_IDENTITY_CHARS
} from "@pi67/domain";
import type { AgentCommandType, AgentEventType } from "./agent-messages.js";
import { AssetReadResultSchema } from "./asset-schemas.js";
import { ApprovalCancelledSchema, ApprovalRequestSchema, ApprovalResolvedSchema } from "./approval-schemas.js";
import {
  ContextFileCatalogResultSchema,
  ContextFileReadResultSchema,
  ContextFileSaveResultSchema
} from "./context-file-schemas.js";
import {
  ExtensionCompatibilitySchema,
  ExtensionUiCancelledSchema,
  ExtensionUiResolvedSchema,
  ExtensionUiRequestSchema
} from "./extension-schemas.js";
import {
  ExtensionCatalogSchema,
  ExtensionCommandAdapterSchema
} from "./extension-catalog-schemas.js";
import {
  ExtensionPackageListResultSchema,
  ExtensionPackageMutationResultSchema,
  ExtensionPackageOnboardingResultSchema,
  ExtensionPackageUpdatesResultSchema
} from "./extension-package-schemas.js";
import {
  SessionCatalogChangedSchema,
  SessionCatalogPageSchema,
  SessionCatalogStatusSchema
} from "./session-catalog-schemas.js";
import { SessionCreationResolutionSchema } from "./session-creation-schemas.js";
import { SessionCompatibilityViewSchema } from "./session-compatibility-schemas.js";
import { SessionExternalChangeSchema } from "./session-external-change-schema.js";
import { SessionTreeProjectionSchema } from "./session-tree-schemas.js";
import {
  WorkspaceChangeEventSchema,
  WorkspaceChangesProjectionSchema
} from "./workspace-change-schemas.js";
import {
  OperationAcceptedSchema,
  OperationActivitySchema,
  OperationKindSchema, OperationViewSchema, ToolExecutionSchema
} from "./operation-schemas.js";
import {
  ConversationPageSchema,
  LocatedMessageWindowSchema,
  MessageSearchResultSchema,
  MessagePageMetadataSchema,
  SessionMessageSchema,
  UserMessageIndexPageSchema,
  WorkspaceMessageSearchResultSchema
} from "./message-schemas.js";
import {
  WorkspaceFileContentSearchResultSchema,
  WorkspaceFileEntryResultSchema,
  WorkspaceFileOpenResultSchema,
  WorkspaceFilePageSchema,
  WorkspaceFileRenameResultSchema,
  WorkspaceFileSearchResultSchema
} from "./workspace-file-schemas.js";
import {
  ModelSummarySchema,
  ProviderSummarySchema,
  SessionControlResultSchema,
  SessionModelCatalogResultSchema
} from "./session-control-schemas.js";
import {
  ResourceSummarySchema,
  SessionResourceCatalogResultSchema
} from "./session-resource-schemas.js";
import { LarkCommandResultSchemas } from "./lark-auth-schemas.js";
import {
  SkillPackListResultSchema,
  SkillPackMutationResultSchema
} from "./skill-pack-schemas.js";
import { ProtocolErrorSchema } from "./protocol-error-schema.js";
import {
  NativeSubagentChangedEventSchema,
  NativeSubagentListResultSchema,
  NativeSubagentViewSchema,
  NativeSubagentWaitResultSchema
} from "./native-subagent-schemas.js";
import {
  PiCredentialRevealResultSchema,
  PiProviderConfigurationChangedSchema,
  PiProviderConfigurationSnapshotSchema
} from "./provider-configuration-schemas.js";
import {
  WorkspaceRegisterResultSchema, WorkspaceUnregisterResultSchema
} from "./workspace-registration-schemas.js";
import { RuntimeDiagnosticsSchema } from "./runtime-diagnostics-schema.js";
import { WorkspaceUsageReportSchema } from "./usage-schemas.js";
import {
  ActiveProposedPlanSchema,
  PlanLifecycleChangeSchema,
  SessionInteractionModeSchema
} from "./session-plan-schemas.js";
export { ProtocolErrorSchema } from "./protocol-error-schema.js";
export { CommandPayloadSchemas } from "./command-payload-schemas.js";
const SessionSnapshotSchema = strictObject({
  sessionId: Type.String(),
  sessionFileIdentity: Type.Optional(Type.String({
    minLength: 1,
    maxLength: MAX_SESSION_FILE_IDENTITY_CHARS
  })),
  sessionPath: Type.Optional(Type.String()),
  sessionName: Type.Optional(Type.String()),
  cwd: Type.String(),
  streaming: Type.Boolean(),
  messages: Type.Array(SessionMessageSchema, { maxItems: 100 }),
  messagePage: MessagePageMetadataSchema,
  models: Type.Array(ModelSummarySchema),
  providers: Type.Array(ProviderSummarySchema),
  selectedModel: Type.Optional(strictObject({ provider: Type.String(), id: Type.String() })),
  thinkingLevel: Type.String(),
  availableThinkingLevels: Type.Array(Type.String()),
  steeringQueue: Type.Array(Type.String()),
  followUpQueue: Type.Array(Type.String()),
  tree: SessionTreeProjectionSchema,
  resources: Type.Array(ResourceSummarySchema),
  interactionMode: Type.Optional(SessionInteractionModeSchema),
  activeProposedPlan: Type.Optional(ActiveProposedPlanSchema),
  planLifecycle: Type.Optional(PlanLifecycleChangeSchema),
  compatibility: Type.Optional(SessionCompatibilityViewSchema),
  stats: Type.Optional(strictObject({
    tokens: Type.Number(),
    cost: Type.Number(),
    contextPercent: Type.Optional(Type.Number())
  }))
});
const RuntimeStatusSchema = strictObject({
  phase: Type.Union([
    Type.Literal("idle"),
    Type.Literal("starting"),
    Type.Literal("ready"),
    Type.Literal("busy"),
    Type.Literal("recovering"),
    Type.Literal("failed"),
    Type.Literal("stopped")
  ]),
  detail: Type.String(),
  recoverable: Type.Boolean(),
  attempt: Type.Optional(Type.Number())
});
const TaskToolModeSchema = Type.Union([
  Type.Literal("ask"),
  Type.Literal("auto"),
  Type.Literal("yolo")
]);
const RuntimeCapabilitiesSchema = strictObject({
  sdkVersion: Type.String(),
  supportsFollowUp: Type.Literal(true),
  supportsSessionTree: Type.Literal(true),
  extensionUi: strictObject({
    primitives: Type.Array(Type.Union([
      Type.Literal("select"), Type.Literal("confirm"), Type.Literal("input"), Type.Literal("editor"),
      Type.Literal("notify"), Type.Literal("status"), Type.Literal("text-widget"), Type.Literal("title")
    ])),
    attribution: Type.Union([Type.Literal("none"), Type.Literal("package"), Type.Literal("package-and-path")]),
    recognizedCompatibilityLevels: Type.Array(Type.Union([
      Type.Literal("native"), Type.Literal("headless"), Type.Literal("adapter"), Type.Literal("partial"),
      Type.Literal("tui-only"), Type.Literal("unsupported")
    ])),
    adapterRegistry: strictObject({
      available: Type.Boolean(),
      manifestSchemaVersions: Type.Array(Type.Integer({ minimum: 1 })),
      supportedSurfaces: Type.Array(Type.Union([Type.Literal("commands"), Type.Literal("tools")])),
      realtimeUiAttribution: Type.Literal(false),
      activeAdapterCount: Type.Integer({ minimum: 0 })
    }),
    limitations: strictObject({
      workingIndicator: Type.Literal("unsupported"),
      editorMutation: Type.Literal("unsupported"),
      customComponents: Type.Literal("tui-only"),
      autocomplete: Type.Literal("tui-only"),
      widgetPlacements: Type.Array(Type.Union([Type.Literal("aboveEditor"), Type.Literal("belowEditor")]))
    })
  })
});

const DoctorCheckSchema = strictObject({
  id: Type.Union([
    Type.Literal("platform"),
    Type.Literal("node"),
    Type.Literal("pi-sdk"),
    Type.Literal("sqlite-runtime"),
    Type.Literal("session-catalog"),
    Type.Literal("shell"),
    Type.Literal("git")
  ]),
  label: Type.String(),
  status: Type.Union([Type.Literal("pass"), Type.Literal("warning"), Type.Literal("fail")]),
  detail: Type.String()
});
const DoctorReportSchema = strictObject({ generatedAt: Type.Number(), checks: Type.Array(DoctorCheckSchema) });

const OperationSettledSchema = operationSettledSchema(OperationKindSchema);

const AcknowledgementSchema = strictObject({ accepted: Type.Literal(true) });
const ProjectionMutationAcknowledgementSchema = strictObject({
  accepted: Type.Literal(true),
  hostEpoch: Type.Integer({ minimum: 0 }),
  sessionId: Type.String(),
  sessionFileIdentity: Type.String({ minLength: 1, maxLength: MAX_SESSION_FILE_IDENTITY_CHARS }),
  sessionGeneration: Type.Integer({ minimum: 0 }),
  eventSequence: Type.Integer({ minimum: 0 })
});
const SlashCommandDescriptorSchema = strictObject({
  name: Type.String({ minLength: 1, maxLength: MAX_SLASH_COMMAND_NAME_CHARS }),
  source: Type.Union([Type.Literal("extension"), Type.Literal("prompt"), Type.Literal("skill")]),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_SLASH_COMMAND_DESCRIPTION_CHARS })),
  adapter: Type.Optional(ExtensionCommandAdapterSchema)
});
const SlashCommandCatalogResultSchema = strictObject({
  items: Type.Array(SlashCommandDescriptorSchema, { maxItems: MAX_SLASH_COMMAND_ITEMS }),
  total: Type.Integer({ minimum: 0 }),
  truncated: Type.Boolean()
});

export const CommandResultSchemas: Record<AgentCommandType, TSchema> = {
  "runtime.initialize": ProjectionMutationAcknowledgementSchema,
  "runtime.getStatus": strictObject({ initialized: Type.Boolean(), loaded: Type.Boolean() }),
  "projection.resync": strictObject({
    snapshot: SessionSnapshotSchema,
    changes: WorkspaceChangesProjectionSchema,
    extensionCatalog: ExtensionCatalogSchema,
    sessionCatalogStatus: SessionCatalogStatusSchema,
    eventSequence: Type.Integer({ minimum: 0 }),
    hostEpoch: Type.Integer({ minimum: 0 }),
    sessionId: Type.String(),
    sessionFileIdentity: Type.String({ minLength: 1, maxLength: MAX_SESSION_FILE_IDENTITY_CHARS }),
    sessionGeneration: Type.Integer({ minimum: 0 }),
    taskToolMode: TaskToolModeSchema,
    activeOperation: Type.Optional(OperationViewSchema),
    latestOperationTerminal: Type.Optional(OperationSettledSchema)
  }),
  "asset.read": AssetReadResultSchema,
  "workspace.open": ProjectionMutationAcknowledgementSchema,
  "workspace.register": WorkspaceRegisterResultSchema,
  "workspace.unregister": WorkspaceUnregisterResultSchema,
  "workspace.setTrust": SessionResourceCatalogResultSchema,
  "workspace.changes": WorkspaceChangesProjectionSchema,
  "workspace.file.list": WorkspaceFilePageSchema,
  "workspace.file.search": WorkspaceFileSearchResultSchema,
  "workspace.file.contentSearch": WorkspaceFileContentSearchResultSchema,
  "workspace.file.resolve": WorkspaceFileEntryResultSchema,
  "workspace.file.open": WorkspaceFileOpenResultSchema,
  "workspace.file.save": WorkspaceFileEntryResultSchema,
  "workspace.file.create": WorkspaceFileEntryResultSchema,
  "workspace.file.rename": WorkspaceFileRenameResultSchema,
  "task.close": strictObject({ closed: Type.Literal(true), stopped: Type.Boolean() }),
  "task.toolMode.set": strictObject({ mode: TaskToolModeSchema }),
  "subagent.list": NativeSubagentListResultSchema,
  "subagent.status": NativeSubagentViewSchema,
  "subagent.wait": NativeSubagentWaitResultSchema,
  "subagent.steer": NativeSubagentViewSchema,
  "subagent.stop": NativeSubagentViewSchema,
  "subagent.resume": NativeSubagentViewSchema,
  "session.catalog.query": SessionCatalogPageSchema,
  "session.catalog.contentSearch": WorkspaceMessageSearchResultSchema,
  "workspace.usage.report": WorkspaceUsageReportSchema,
  "session.tree": SessionTreeProjectionSchema,
  "message.page": ConversationPageSchema,
  "message.index": UserMessageIndexPageSchema,
  "message.search": MessageSearchResultSchema,
  "message.locate": LocatedMessageWindowSchema,
  "session.create": ProjectionMutationAcknowledgementSchema,
  "session.creation.resolve": SessionCreationResolutionSchema,
  "session.open": ProjectionMutationAcknowledgementSchema,
  "session.import": operationSubmissionResultSchema(Type.Literal("session-import")),
  "session.fork": ProjectionMutationAcknowledgementSchema,
  "session.forkFromTask": ProjectionMutationAcknowledgementSchema,
  "session.rollback": ProjectionMutationAcknowledgementSchema,
  "session.compact": operationSubmissionResultSchema(Type.Literal("compaction")),
  "session.name": ProjectionMutationAcknowledgementSchema,
  "session.interactionMode.set": ProjectionMutationAcknowledgementSchema,
  "plan.implement": operationSubmissionResultSchema(Type.Literal("prompt")),
  "session.nameByPath": strictObject({ revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) }),
  "conversation.pin": strictObject({ revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) }),
  "conversation.archive": strictObject({ revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) }),
  "conversation.snooze": strictObject({ revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) }),
  "conversation.reorderPinned": strictObject({ revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) }),
  "prompt.submit": operationSubmissionResultSchema(Type.Literal("prompt")),
  "prompt.steer": AcknowledgementSchema,
  "prompt.followUp": AcknowledgementSchema,
  "queue.clear": strictObject({
    steeringCount: Type.Integer({ minimum: 0 }),
    followUpCount: Type.Integer({ minimum: 0 }),
    pendingCount: Type.Integer({ minimum: 0 })
  }),
  "operation.abort": strictObject({ aborted: Type.Boolean(), operationId: Type.Optional(Type.String()) }),
  "model.list": Type.Array(ModelSummarySchema),
  "model.select": SessionModelCatalogResultSchema,
  "model.setRuntimeKey": SessionModelCatalogResultSchema,
  "provider.list": Type.Array(ProviderSummarySchema),
  "provider.setRuntimeKey": Type.Array(ProviderSummarySchema),
  "provider.configuration.get": PiProviderConfigurationSnapshotSchema,
  "provider.configuration.save": PiProviderConfigurationSnapshotSchema,
  "provider.configuration.remove": PiProviderConfigurationSnapshotSchema,
  "provider.credential.store": PiProviderConfigurationSnapshotSchema,
  "provider.credential.reveal": PiCredentialRevealResultSchema,
  "provider.credential.remove": PiProviderConfigurationSnapshotSchema,
  "model.default.set": PiProviderConfigurationSnapshotSchema,
  "provider.configuration.reload": PiProviderConfigurationSnapshotSchema,
  "thinking.set": SessionControlResultSchema,
  "resource.list": Type.Array(ResourceSummarySchema),
  "resource.reload": SessionResourceCatalogResultSchema,
  "context.file.list": ContextFileCatalogResultSchema,
  "context.file.read": ContextFileReadResultSchema,
  "context.file.save": ContextFileSaveResultSchema,
  "command.list": SlashCommandCatalogResultSchema,
  "command.invoke": operationSubmissionResultSchema(Type.Literal("command")),
  "extension.catalog.list": ExtensionCatalogSchema,
  "extension.package.list": ExtensionPackageListResultSchema,
  "extension.package.checkUpdates": ExtensionPackageUpdatesResultSchema,
  "extension.package.install": ExtensionPackageMutationResultSchema,
  "extension.package.update": ExtensionPackageMutationResultSchema,
  "extension.package.approveObserved": ExtensionPackageMutationResultSchema,
  "extension.package.onboarding.get": ExtensionPackageOnboardingResultSchema,
  "extension.package.onboarding.decline": ExtensionPackageOnboardingResultSchema,
  "extension.package.setEnabled": ExtensionPackageMutationResultSchema,
  "extension.package.restoreInheritance": ExtensionPackageMutationResultSchema,
  "extension.package.uninstall": ExtensionPackageMutationResultSchema,
  "skill.pack.list": SkillPackListResultSchema,
  "skill.pack.checkUpdates": SkillPackListResultSchema,
  "skill.pack.install": SkillPackMutationResultSchema,
  "skill.pack.update": SkillPackMutationResultSchema,
  "skill.pack.restore": SkillPackMutationResultSchema,
  ...LarkCommandResultSchemas,
  "extension.ui.respond": strictObject({ resolved: Type.Boolean() }),
  "approval.respond": strictObject({
    resolved: Type.Boolean(),
    taskToolMode: TaskToolModeSchema
  }),
  "diagnostics.collect": RuntimeDiagnosticsSchema,
  "doctor.run": DoctorReportSchema
};

const StreamDeltaSchema = strictObject({
  assistantMessageEvent: strictObject({
    type: Type.Union([Type.Literal("text_delta"), Type.Literal("thinking_delta")]),
    delta: Type.String()
  })
});

export const EventPayloadSchemas: Record<AgentEventType, TSchema> = {
  "runtime.statusChanged": RuntimeStatusSchema,
  "runtime.ready": strictObject({
    capabilities: RuntimeCapabilitiesSchema,
    snapshot: SessionSnapshotSchema,
    taskToolMode: TaskToolModeSchema
  }),
  "runtime.crashed": strictObject({ detail: Type.String(), recoverable: Type.Boolean() }),
  "session.bootstrap": strictObject({
    snapshot: SessionSnapshotSchema,
    reason: Type.Union([
      Type.Literal("session-create"),
      Type.Literal("session-open"),
      Type.Literal("session-fork"),
      Type.Literal("session-import")
    ])
  }),
  "conversation.changed": strictObject({
    sessionId: Type.String(),
    reason: Type.Union([
      Type.Literal("user-appended"),
      Type.Literal("settled"),
      Type.Literal("compacted"),
      Type.Literal("rolled-back")
    ])
  }),
  "queue.changed": strictObject({
    steeringQueue: Type.Array(Type.String()),
    followUpQueue: Type.Array(Type.String())
  }),
  "session.metaChanged": strictObject({
    streaming: Type.Boolean(),
    sessionName: Type.Optional(Type.String()),
    thinkingLevel: Type.String(),
    selectedModel: Type.Optional(strictObject({ provider: Type.String(), id: Type.String() }))
  }),
  "session.interactionModeChanged": strictObject({
    interactionMode: SessionInteractionModeSchema
  }),
  "plan.proposed": strictObject({ plan: ActiveProposedPlanSchema }),
  "plan.lifecycleChanged": PlanLifecycleChangeSchema,
  "model.catalog.changed": SessionModelCatalogResultSchema,
  "tree.changed": strictObject({
    reason: Type.Union([Type.Literal("session-entry"), Type.Literal("compacted"), Type.Literal("rollback")])
  }),
  "usage.changed": strictObject({
    tokens: Type.Number(),
    cost: Type.Number(),
    contextPercent: Type.Optional(Type.Number())
  }),
  "session.catalog.changed": SessionCatalogChangedSchema,
  "session.externalChangeDetected": SessionExternalChangeSchema,
  "provider.configuration.changed": PiProviderConfigurationChangedSchema,
  "turn.streamBatch": strictObject({ events: Type.Array(StreamDeltaSchema) }),
  "operation.started": strictObject({ operation: OperationViewSchema }),
  "operation.heartbeat": strictObject({
    operationId: Type.String({ minLength: 1, maxLength: 512 }),
    observedAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    lastActivityAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  }),
  "operation.activityChanged": strictObject({ operationId: Type.String(), activity: Type.Union([OperationActivitySchema, Type.Null()]) }),
  "operation.toolExecutionChanged": strictObject({ operationId: Type.String({ minLength: 1, maxLength: 512 }), execution: ToolExecutionSchema }),
  "operation.progress": strictObject({
    operationId: Type.String(),
    message: Type.String(),
    current: Type.Optional(Type.Number()),
    total: Type.Optional(Type.Number())
  }),
  "operation.completed": strictObject({ operationId: Type.String(), completedAt: Type.Number() }),
  "operation.failed": strictObject({ operationId: Type.String(), failedAt: Type.Number(), error: ProtocolErrorSchema }),
  "operation.cancelled": strictObject({ operationId: Type.String(), cancelledAt: Type.Number(), reason: Type.String() }),
  "operation.lost": strictObject({ operationId: Type.String(), lostAt: Type.Number(), reason: Type.String() }),
  "workspace.changeChanged": WorkspaceChangeEventSchema,
  "approval.requested": ApprovalRequestSchema,
  "approval.resolved": ApprovalResolvedSchema,
  "approval.cancelled": ApprovalCancelledSchema,
  "task.toolMode.changed": strictObject({
    mode: TaskToolModeSchema,
    reason: Type.Union([
      Type.Literal("user-selected"),
      Type.Literal("approval-enabled-yolo"),
      Type.Literal("trust-revoked"),
      Type.Literal("runtime-reset")
    ])
  }),
  "subagent.changed": NativeSubagentChangedEventSchema,
  "extension.ui.requested": ExtensionUiRequestSchema,
  "extension.ui.updated": ExtensionUiRequestSchema,
  "extension.ui.resolved": ExtensionUiResolvedSchema,
  "extension.ui.cancelled": ExtensionUiCancelledSchema,
  "extension.compatibilityChanged": ExtensionCompatibilitySchema,
  "extension.catalog.changed": ExtensionCatalogSchema,
  "resource.changed": strictObject({ reason: Type.String() }),
  "diagnostics.progress": strictObject({ step: Type.String(), completed: Type.Boolean() }),
  "doctor.completed": DoctorReportSchema
};
function operationSubmissionResultSchema(operationKind: TSchema): TSchema {
  return Type.Union([OperationAcceptedSchema, operationSettledSchema(operationKind)]);
}

function operationSettledSchema(operationKind: TSchema): TSchema {
  const base = {
    kind: Type.Literal("settled"),
    operationId: Type.String(),
    operationKind,
    cancellable: Type.Literal(false),
    hostEpoch: Type.Integer({ minimum: 0 }),
    sessionId: Type.String(),
    sessionFileIdentity: Type.String({ minLength: 1, maxLength: MAX_SESSION_FILE_IDENTITY_CHARS }),
    sessionGeneration: Type.Integer({ minimum: 0 }),
    startedAt: Type.Number(),
    settledAt: Type.Number()
  };
  return Type.Union([
    strictObject({ ...base, lifecycle: Type.Literal("completed") }),
    strictObject({ ...base, lifecycle: Type.Literal("failed"), error: ProtocolErrorSchema }),
    strictObject({ ...base, lifecycle: Type.Literal("cancelled"), reason: Type.String() }),
    strictObject({ ...base, lifecycle: Type.Literal("lost"), reason: Type.String() })
  ]);
}
export function strictObject<T extends TProperties>(properties: T) { return Type.Object(properties, { additionalProperties: false }); }
