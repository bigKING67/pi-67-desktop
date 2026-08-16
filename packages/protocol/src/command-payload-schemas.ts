import { Type, type TProperties, type TSchema } from "./typebox-schema.js";
import type { AgentCommandType } from "./agent-messages.js";
import { ApprovalRespondSchema } from "./approval-schemas.js";
import { AssetReadPayloadSchema } from "./asset-schemas.js";
import {
  ContextFileListPayloadSchema,
  ContextFileReadPayloadSchema,
  ContextFileSavePayloadSchema
} from "./context-file-schemas.js";
import {
  ExtensionPackageEnabledTargetSchema,
  ExtensionPackageInheritanceTargetSchema,
  ExtensionPackageTargetSchema
} from "./extension-package-schemas.js";
import {
  PiConfigurationExpectedRevisionSchema,
  PiConfigurationProviderIdSchema,
  PiProviderConfigurationInputSchema
} from "./provider-configuration-schemas.js";
import { LarkAppConfigurationInputSchema } from "./lark-auth-schemas.js";
import { SessionCatalogQuerySchema } from "./session-catalog-schemas.js";
import { SessionCreationIdSchema } from "./session-creation-schemas.js";
import { SkillPackTargetSchema } from "./skill-pack-schemas.js";
import {
  NativeSubagentListPayloadSchema,
  NativeSubagentResumePayloadSchema,
  NativeSubagentStatusPayloadSchema,
  NativeSubagentSteerPayloadSchema,
  NativeSubagentStopPayloadSchema,
  NativeSubagentWaitPayloadSchema
} from "./native-subagent-schemas.js";
import { WorkspaceRegisterPayloadSchema } from "./workspace-registration-schemas.js";
import { WorkspaceUsageReportPayloadSchema } from "./usage-schemas.js";
import {
  WorkspaceFileContentSearchPayloadSchema,
  WorkspaceFileCreatePayloadSchema,
  WorkspaceFileListPayloadSchema,
  WorkspaceFileOpenPayloadSchema,
  WorkspaceFileRenamePayloadSchema,
  WorkspaceFileResolvePayloadSchema,
  WorkspaceFileSavePayloadSchema,
  WorkspaceFileSearchPayloadSchema,
  WorkspaceFilePromptRefSchema
} from "./workspace-file-schemas.js";
import {
  MAX_COMPOSER_WORKSPACE_FILE_REFS,
  MAX_MESSAGE_SEARCH_QUERY_CHARS,
  MAX_PINNED_CONVERSATION_ORDER_ITEMS,
  MAX_SESSION_FILE_IDENTITY_CHARS,
  MAX_USER_MESSAGE_INDEX_PAGE_ITEMS
} from "@pi67/domain";

const EmptyPayloadSchema = strictObject({});
const TrustSchema = Type.Union([Type.Literal("unknown"), Type.Literal("trusted"), Type.Literal("untrusted")]);
const ApprovalModeSchema = Type.Union([Type.Literal("guided"), Type.Literal("balanced")]);
const TaskToolModeSchema = Type.Union([
  Type.Literal("ask"),
  Type.Literal("auto"),
  Type.Literal("yolo")
]);
const PathSchema = Type.String({ minLength: 1, maxLength: 32_768 });
const PromptSchema = Type.String({ maxLength: 2_000_000 });
const SubmissionIdSchema = Type.String({ minLength: 1, maxLength: 512 });
const PlanIdSchema = Type.String({ minLength: 1, maxLength: 128 });
const PromptAttachmentRefSchema = strictObject({
  id: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" })
});
const PromptAttachmentsSchema = Type.Optional(Type.Array(PromptAttachmentRefSchema, { maxItems: 20 }));
const PromptWorkspaceFilesSchema = Type.Optional(Type.Array(WorkspaceFilePromptRefSchema, {
  maxItems: MAX_COMPOSER_WORKSPACE_FILE_REFS
}));
const PromptPayloadSchema = strictObject({ text: PromptSchema });
const SessionNameMutationSchema = Type.Union([
  strictObject({
    action: Type.Literal("set"),
    name: Type.String({ minLength: 1, maxLength: 256 })
  }),
  strictObject({ action: Type.Literal("clear") })
]);

export const CommandPayloadSchemas: Record<AgentCommandType, TSchema> = {
  "runtime.initialize": strictObject({
    cwd: PathSchema,
    agentDir: Type.Optional(PathSchema),
    sessionPath: Type.Optional(PathSchema),
    trust: TrustSchema,
    approvalMode: ApprovalModeSchema
  }),
  "runtime.getStatus": EmptyPayloadSchema,
  "projection.resync": EmptyPayloadSchema,
  "asset.read": AssetReadPayloadSchema,
  "workspace.open": WorkspaceRegisterPayloadSchema,
  "workspace.register": WorkspaceRegisterPayloadSchema,
  "workspace.unregister": EmptyPayloadSchema,
  "workspace.setTrust": strictObject({ trust: TrustSchema, approvalMode: ApprovalModeSchema }),
  "workspace.changes": EmptyPayloadSchema,
  "workspace.file.list": WorkspaceFileListPayloadSchema,
  "workspace.file.search": WorkspaceFileSearchPayloadSchema,
  "workspace.file.contentSearch": WorkspaceFileContentSearchPayloadSchema,
  "workspace.file.resolve": WorkspaceFileResolvePayloadSchema,
  "workspace.file.open": WorkspaceFileOpenPayloadSchema,
  "workspace.file.save": WorkspaceFileSavePayloadSchema,
  "workspace.file.create": WorkspaceFileCreatePayloadSchema,
  "workspace.file.rename": WorkspaceFileRenamePayloadSchema,
  "task.close": strictObject({ mode: Type.Union([Type.Literal("stop"), Type.Literal("dispose")]) }),
  "task.toolMode.set": strictObject({ mode: TaskToolModeSchema }),
  "subagent.list": NativeSubagentListPayloadSchema,
  "subagent.status": NativeSubagentStatusPayloadSchema,
  "subagent.wait": NativeSubagentWaitPayloadSchema,
  "subagent.steer": NativeSubagentSteerPayloadSchema,
  "subagent.stop": NativeSubagentStopPayloadSchema,
  "subagent.resume": NativeSubagentResumePayloadSchema,
  "session.catalog.query": SessionCatalogQuerySchema,
  "session.catalog.contentSearch": strictObject({
    query: Type.String({ minLength: 1, maxLength: MAX_MESSAGE_SEARCH_QUERY_CHARS })
  }),
  "workspace.usage.report": WorkspaceUsageReportPayloadSchema,
  "session.tree": EmptyPayloadSchema,
  "message.page": strictObject({
    direction: Type.Union([Type.Literal("older"), Type.Literal("newer")]),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 }))
  }),
  "message.index": strictObject({
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_USER_MESSAGE_INDEX_PAGE_ITEMS }))
  }),
  "message.search": strictObject({
    query: Type.String({ minLength: 1, maxLength: MAX_MESSAGE_SEARCH_QUERY_CHARS })
  }),
  "message.locate": strictObject({ id: Type.String({ minLength: 1, maxLength: 512 }) }),
  "session.create": strictObject({ creationId: SessionCreationIdSchema }),
  "session.creation.resolve": strictObject({ creationId: SessionCreationIdSchema }),
  "session.open": strictObject({ path: PathSchema, cwdOverride: Type.Optional(PathSchema) }),
  "session.import": strictObject({ submissionId: SubmissionIdSchema, path: PathSchema }),
  "session.fork": strictObject({
    entryId: Type.String({ minLength: 1 }),
    position: Type.Optional(Type.Union([Type.Literal("before"), Type.Literal("at")]))
  }),
  "session.forkFromTask": strictObject({
    sourceTaskId: Type.String({ minLength: 1, maxLength: 512 }),
    sourceTaskGeneration: Type.Integer({ minimum: 1 }),
    sourceSessionId: Type.String({ minLength: 1, maxLength: 512 }),
    sourceSessionFileIdentity: Type.String({
      minLength: 1,
      maxLength: MAX_SESSION_FILE_IDENTITY_CHARS
    }),
    sourceSessionGeneration: Type.Integer({ minimum: 1 }),
    entryId: Type.String({ minLength: 1 })
  }),
  "session.rollback": strictObject({ entryId: Type.String({ minLength: 1 }), summarize: Type.Optional(Type.Boolean()) }),
  "session.compact": strictObject({ submissionId: SubmissionIdSchema, instructions: Type.Optional(PromptSchema) }),
  "session.name": strictObject({ mutation: SessionNameMutationSchema }),
  "session.interactionMode.set": strictObject({
    mode: Type.Union([Type.Literal("execute"), Type.Literal("plan")])
  }),
  "plan.implement": strictObject({ submissionId: SubmissionIdSchema, planId: PlanIdSchema }),
  "session.nameByPath": strictObject({ path: PathSchema, mutation: SessionNameMutationSchema }),
  "conversation.pin": strictObject({ path: PathSchema, pinned: Type.Boolean() }),
  "conversation.archive": strictObject({ path: PathSchema, archived: Type.Boolean() }),
  "conversation.snooze": strictObject({
    path: PathSchema,
    snoozedUntil: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
  }),
  "conversation.reorderPinned": strictObject({
    paths: Type.Array(PathSchema, { minItems: 1, maxItems: MAX_PINNED_CONVERSATION_ORDER_ITEMS })
  }),
  "prompt.submit": strictObject({
    submissionId: SubmissionIdSchema,
    text: PromptSchema,
    attachments: PromptAttachmentsSchema,
    workspaceFiles: PromptWorkspaceFilesSchema,
    delivery: Type.Union([Type.Literal("new-turn"), Type.Literal("steer"), Type.Literal("follow-up")])
  }),
  "prompt.steer": PromptPayloadSchema,
  "prompt.followUp": PromptPayloadSchema,
  "queue.clear": EmptyPayloadSchema,
  "operation.abort": strictObject({ operationId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })) }),
  "model.list": EmptyPayloadSchema,
  "model.select": strictObject({
    provider: Type.String({ minLength: 1, maxLength: 256 }),
    id: Type.String({ minLength: 1, maxLength: 512 })
  }),
  "model.setRuntimeKey": strictObject({
    provider: Type.String({ minLength: 1, maxLength: 256 }),
    apiKey: Type.String({ minLength: 8, maxLength: 16_384 })
  }),
  "provider.list": EmptyPayloadSchema,
  "provider.setRuntimeKey": strictObject({
    provider: Type.String({ minLength: 1, maxLength: 256 }),
    apiKey: Type.String({ minLength: 8, maxLength: 16_384 })
  }),
  "provider.configuration.get": EmptyPayloadSchema,
  "provider.configuration.save": strictObject({
    expectedRevision: PiConfigurationExpectedRevisionSchema,
    provider: PiProviderConfigurationInputSchema
  }),
  "provider.configuration.remove": strictObject({
    expectedRevision: PiConfigurationExpectedRevisionSchema,
    provider: PiConfigurationProviderIdSchema
  }),
  "provider.credential.store": strictObject({
    expectedRevision: PiConfigurationExpectedRevisionSchema,
    provider: PiConfigurationProviderIdSchema,
    apiKey: Type.String({ minLength: 8, maxLength: 16_384 })
  }),
  "provider.credential.reveal": strictObject({
    expectedRevision: PiConfigurationExpectedRevisionSchema,
    provider: PiConfigurationProviderIdSchema
  }),
  "provider.credential.remove": strictObject({
    expectedRevision: PiConfigurationExpectedRevisionSchema,
    provider: PiConfigurationProviderIdSchema
  }),
  "model.default.set": Type.Union([
    strictObject({
      expectedRevision: PiConfigurationExpectedRevisionSchema,
      scope: Type.Union([Type.Literal("global"), Type.Literal("project")])
    }),
    strictObject({
      expectedRevision: PiConfigurationExpectedRevisionSchema,
      scope: Type.Union([Type.Literal("global"), Type.Literal("project")]),
      provider: PiConfigurationProviderIdSchema,
      model: PiConfigurationProviderIdSchema
    })
  ]),
  "provider.configuration.reload": EmptyPayloadSchema,
  "provider.projectConfiguration.get": EmptyPayloadSchema,
  "provider.projectConfiguration.reload": EmptyPayloadSchema,
  "model.projectDefault.set": Type.Union([
    strictObject({ expectedRevision: PiConfigurationExpectedRevisionSchema }),
    strictObject({
      expectedRevision: PiConfigurationExpectedRevisionSchema,
      provider: PiConfigurationProviderIdSchema,
      model: PiConfigurationProviderIdSchema
    })
  ]),
  "vision.assistant.global.set": Type.Union([
    strictObject({ expectedRevision: PiConfigurationExpectedRevisionSchema }),
    strictObject({
      expectedRevision: PiConfigurationExpectedRevisionSchema,
      provider: PiConfigurationProviderIdSchema,
      model: PiConfigurationProviderIdSchema
    })
  ]),
  "vision.assistant.project.set": Type.Union([
    strictObject({
      expectedRevision: PiConfigurationExpectedRevisionSchema,
      mode: Type.Union([Type.Literal("inherit"), Type.Literal("disabled")])
    }),
    strictObject({
      expectedRevision: PiConfigurationExpectedRevisionSchema,
      mode: Type.Literal("model"),
      provider: PiConfigurationProviderIdSchema,
      model: PiConfigurationProviderIdSchema
    })
  ]),
  "thinking.set": strictObject({ level: Type.String({ minLength: 1, maxLength: 32 }) }),
  "resource.list": EmptyPayloadSchema,
  "resource.reload": EmptyPayloadSchema,
  "context.file.list": ContextFileListPayloadSchema,
  "context.file.read": ContextFileReadPayloadSchema,
  "context.file.save": ContextFileSavePayloadSchema,
  "command.list": EmptyPayloadSchema,
  "command.invoke": strictObject({
    submissionId: SubmissionIdSchema,
    command: Type.String({ minLength: 1, maxLength: 16_384 })
  }),
  "extension.catalog.list": EmptyPayloadSchema,
  "extension.package.list": EmptyPayloadSchema,
  "extension.package.checkUpdates": EmptyPayloadSchema,
  "extension.package.install": ExtensionPackageTargetSchema,
  "extension.package.update": ExtensionPackageTargetSchema,
  "extension.package.approveObserved": ExtensionPackageTargetSchema,
  "extension.package.onboarding.get": ExtensionPackageTargetSchema,
  "extension.package.onboarding.decline": ExtensionPackageTargetSchema,
  "extension.package.setEnabled": ExtensionPackageEnabledTargetSchema,
  "extension.package.restoreInheritance": ExtensionPackageInheritanceTargetSchema,
  "extension.package.uninstall": ExtensionPackageTargetSchema,
  "skill.pack.list": EmptyPayloadSchema,
  "skill.pack.checkUpdates": EmptyPayloadSchema,
  "skill.pack.install": SkillPackTargetSchema,
  "skill.pack.update": SkillPackTargetSchema,
  "skill.pack.restore": SkillPackTargetSchema,
  "lark.auth.status": EmptyPayloadSchema,
  "lark.auth.login.begin": EmptyPayloadSchema,
  "lark.app.configuration.save": LarkAppConfigurationInputSchema,
  "extension.ui.respond": strictObject({
    requestId: Type.String({ minLength: 1, maxLength: 512 }),
    sessionId: Type.String({ minLength: 1, maxLength: 512 }),
    sessionGeneration: Type.Integer({ minimum: 0 }),
    operationId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    value: Type.Optional(Type.Union([Type.String({ maxLength: 2_000_000 }), Type.Boolean()])),
    cancelled: Type.Optional(Type.Boolean())
  }),
  "approval.respond": ApprovalRespondSchema,
  "diagnostics.collect": EmptyPayloadSchema,
  "doctor.run": EmptyPayloadSchema
};

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
