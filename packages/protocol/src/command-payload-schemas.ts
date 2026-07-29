import { Type, type TProperties, type TSchema } from "typebox";
import type { AgentCommandType } from "./agent-messages.js";
import { ApprovalRespondSchema } from "./approval-schemas.js";
import { AssetReadPayloadSchema } from "./asset-schemas.js";
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
import { SessionCatalogQuerySchema } from "./session-catalog-schemas.js";
import { WorkspaceRegisterPayloadSchema } from "./workspace-registration-schemas.js";

const EmptyPayloadSchema = strictObject({});
const TrustSchema = Type.Union([Type.Literal("unknown"), Type.Literal("trusted"), Type.Literal("untrusted")]);
const ApprovalModeSchema = Type.Union([Type.Literal("guided"), Type.Literal("balanced")]);
const PathSchema = Type.String({ minLength: 1, maxLength: 32_768 });
const PromptSchema = Type.String({ maxLength: 2_000_000 });
const SubmissionIdSchema = Type.String({ minLength: 1, maxLength: 512 });
const TransferImageSchema = strictObject({
  name: Type.String({ minLength: 1, maxLength: 512 }),
  mimeType: Type.String({ minLength: 1, maxLength: 128 }),
  // ArrayBuffer is verified with an explicit runtime predicate after TypeBox validation.
  data: Type.Any()
});
const ImagesSchema = Type.Optional(Type.Array(TransferImageSchema, { maxItems: 8 }));
const PromptPayloadSchema = strictObject({ text: PromptSchema, images: ImagesSchema });

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
  "task.close": strictObject({ mode: Type.Union([Type.Literal("stop"), Type.Literal("dispose")]) }),
  "session.catalog.query": SessionCatalogQuerySchema,
  "session.tree": EmptyPayloadSchema,
  "message.page": strictObject({
    direction: Type.Union([Type.Literal("older"), Type.Literal("newer")]),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 }))
  }),
  "session.create": EmptyPayloadSchema,
  "session.open": strictObject({ path: PathSchema, cwdOverride: Type.Optional(PathSchema) }),
  "session.import": strictObject({ submissionId: SubmissionIdSchema, path: PathSchema }),
  "session.fork": strictObject({ entryId: Type.String({ minLength: 1 }) }),
  "session.rollback": strictObject({ entryId: Type.String({ minLength: 1 }), summarize: Type.Optional(Type.Boolean()) }),
  "session.compact": strictObject({ submissionId: SubmissionIdSchema, instructions: Type.Optional(PromptSchema) }),
  "session.name": strictObject({ name: Type.String({ minLength: 1, maxLength: 256 }) }),
  "prompt.submit": strictObject({
    submissionId: SubmissionIdSchema,
    text: PromptSchema,
    images: ImagesSchema,
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
  "thinking.set": strictObject({ level: Type.String({ minLength: 1, maxLength: 32 }) }),
  "resource.list": EmptyPayloadSchema,
  "resource.reload": EmptyPayloadSchema,
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
  "extension.package.setEnabled": ExtensionPackageEnabledTargetSchema,
  "extension.package.restoreInheritance": ExtensionPackageInheritanceTargetSchema,
  "extension.package.uninstall": ExtensionPackageTargetSchema,
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
