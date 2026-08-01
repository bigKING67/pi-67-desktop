import { MAX_APPROVAL_CWD_BYTES, MAX_APPROVAL_TARGET_BYTES } from "@pi67/domain";
import { Type, type TProperties } from "./typebox-schema.js";
import {
  ExtensionUiCancellationReasonSchema,
  MAX_EXTENSION_UI_CANCELLED_REQUESTS
} from "./extension-schemas.js";

const ApprovalIdentifierSchema = Type.String({ minLength: 1, maxLength: 512 });

const RiskCategorySchema = Type.Union([
  Type.Literal("workspace-read"),
  Type.Literal("resource-read"),
  Type.Literal("workspace-write"),
  Type.Literal("workspace-command"),
  Type.Literal("capability-read"),
  Type.Literal("external-path"),
  Type.Literal("bulk-delete"),
  Type.Literal("destructive-shell"),
  Type.Literal("system-configuration"),
  Type.Literal("dependency-change"),
  Type.Literal("git-external-action"),
  Type.Literal("download-and-execute"),
  Type.Literal("network-read"),
  Type.Literal("network-side-effect"),
  Type.Literal("configured-operation"),
  Type.Literal("persistent-state-write"),
  Type.Literal("persistent-state-delete"),
  Type.Literal("external-submit"),
  Type.Literal("credential-or-auth"),
  Type.Literal("unverified-tool"),
  Type.Literal("ambiguous-command")
]);

export const ApprovalRequestSchema = strictObject({
  requestId: Type.String({ minLength: 1, maxLength: 512 }),
  sessionId: Type.String({ minLength: 1, maxLength: 512 }),
  sessionGeneration: Type.Integer({ minimum: 0 }),
  operationId: Type.String({ minLength: 1, maxLength: 512 }),
  hostEpoch: Type.Integer({ minimum: 0 }),
  toolCallId: Type.String({ minLength: 1, maxLength: 512 }),
  toolName: Type.String({ minLength: 1, maxLength: 256 }),
  toolSource: Type.String({ minLength: 1, maxLength: 512 }),
  category: RiskCategorySchema,
  reason: Type.String({ minLength: 1, maxLength: 512 }),
  targetKind: Type.Union([Type.Literal("command"), Type.Literal("path"), Type.Literal("tool")]),
  target: Type.String({ maxLength: MAX_APPROVAL_TARGET_BYTES }),
  targetTruncated: Type.Boolean(),
  cwd: Type.String({ maxLength: MAX_APPROVAL_CWD_BYTES }),
  cwdTruncated: Type.Boolean(),
  scope: Type.Literal("single-tool-call")
});

export const ApprovalRespondSchema = strictObject({
  requestId: ApprovalIdentifierSchema,
  toolCallId: ApprovalIdentifierSchema,
  sessionId: ApprovalIdentifierSchema,
  sessionGeneration: Type.Integer({ minimum: 0 }),
  operationId: ApprovalIdentifierSchema,
  decision: Type.Union([
    Type.Literal("deny"),
    Type.Literal("allow-once"),
    Type.Literal("enable-task-yolo-and-allow")
  ])
});

const ApprovalTerminalIdentitySchema = strictObject({
  requestId: ApprovalIdentifierSchema,
  toolCallId: ApprovalIdentifierSchema
});

export const ApprovalResolvedSchema = strictObject({
  requestId: ApprovalIdentifierSchema,
  toolCallId: ApprovalIdentifierSchema,
  decision: Type.Union([
    Type.Literal("deny"),
    Type.Literal("allow-once"),
    Type.Literal("enable-task-yolo-and-allow")
  ])
});

export const ApprovalCancelledSchema = strictObject({
  requests: Type.Array(ApprovalTerminalIdentitySchema, {
    minItems: 1,
    maxItems: MAX_EXTENSION_UI_CANCELLED_REQUESTS
  }),
  reason: ExtensionUiCancellationReasonSchema
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
