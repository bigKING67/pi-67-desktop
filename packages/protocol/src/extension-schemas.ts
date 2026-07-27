import { Type, type TProperties } from "typebox";

export const MAX_EXTENSION_UI_IDENTIFIER_LENGTH = 512;
export const MAX_EXTENSION_PACKAGE_LENGTH = 512;
export const MAX_EXTENSION_PATH_LENGTH = 32_768;
export const MAX_EXTENSION_UI_TITLE_LENGTH = 512;
export const MAX_EXTENSION_UI_MESSAGE_LENGTH = 64 * 1024;
export const MAX_EXTENSION_UI_PLACEHOLDER_LENGTH = 1_024;
export const MAX_EXTENSION_UI_OPTIONS = 256;
export const MAX_EXTENSION_UI_OPTION_LENGTH = 1_024;
export const MAX_EXTENSION_UI_KEY_LENGTH = 256;
export const MAX_EXTENSION_UI_CANCELLED_REQUESTS = 512;
export const MAX_EXTENSION_COMPATIBILITY_DETAIL_LENGTH = 8 * 1_024;

const IdentifierSchema = Type.String({ minLength: 1, maxLength: MAX_EXTENSION_UI_IDENTIFIER_LENGTH });
const ExtensionPackageSchema = Type.String({ minLength: 1, maxLength: MAX_EXTENSION_PACKAGE_LENGTH });
const ExtensionPathSchema = Type.String({ minLength: 1, maxLength: MAX_EXTENSION_PATH_LENGTH });

export const ExtensionUiRequestSchema = strictObject({
  requestId: IdentifierSchema,
  extensionId: Type.Optional(IdentifierSchema),
  extensionPackage: Type.Optional(ExtensionPackageSchema),
  extensionPath: Type.Optional(ExtensionPathSchema),
  sessionId: Type.Optional(IdentifierSchema),
  sessionGeneration: Type.Optional(Type.Integer({ minimum: 0 })),
  operationId: Type.Optional(IdentifierSchema),
  hostEpoch: Type.Optional(Type.Integer({ minimum: 0 })),
  kind: Type.Union([
    Type.Literal("select"), Type.Literal("confirm"), Type.Literal("input"), Type.Literal("editor"),
    Type.Literal("notify"), Type.Literal("status"), Type.Literal("widget"), Type.Literal("working"),
    Type.Literal("title"), Type.Literal("editor-text"), Type.Literal("unsupported")
  ]),
  title: Type.Optional(Type.String({ maxLength: MAX_EXTENSION_UI_TITLE_LENGTH })),
  message: Type.Optional(Type.String({ maxLength: MAX_EXTENSION_UI_MESSAGE_LENGTH })),
  placeholder: Type.Optional(Type.String({ maxLength: MAX_EXTENSION_UI_PLACEHOLDER_LENGTH })),
  options: Type.Optional(Type.Array(
    Type.String({ maxLength: MAX_EXTENSION_UI_OPTION_LENGTH }),
    { maxItems: MAX_EXTENSION_UI_OPTIONS }
  )),
  level: Type.Optional(Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("error")])),
  key: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_EXTENSION_UI_KEY_LENGTH })),
  placement: Type.Optional(Type.Union([Type.Literal("aboveEditor"), Type.Literal("belowEditor")])),
  blocking: Type.Boolean()
});

export const ExtensionUiCancellationReasonSchema = Type.Union([
  Type.Literal("session-transition"), Type.Literal("resource-reload"), Type.Literal("runtime-dispose"),
  Type.Literal("connection-close"), Type.Literal("projection-resync"),
  Type.Literal("timeout"), Type.Literal("abort")
]);

export const ExtensionUiResolvedSchema = strictObject({
  requestId: IdentifierSchema,
  cancelled: Type.Boolean()
});

export const ExtensionUiCancelledSchema = strictObject({
  requestIds: Type.Array(IdentifierSchema, { maxItems: MAX_EXTENSION_UI_CANCELLED_REQUESTS }),
  reason: ExtensionUiCancellationReasonSchema
});

export const ExtensionCompatibilitySchema = strictObject({
  extensionId: Type.Optional(IdentifierSchema),
  extensionPackage: Type.Optional(ExtensionPackageSchema),
  extensionPath: Type.Optional(ExtensionPathSchema),
  sessionId: Type.Optional(IdentifierSchema),
  sessionGeneration: Type.Optional(Type.Integer({ minimum: 0 })),
  operationId: Type.Optional(IdentifierSchema),
  hostEpoch: Type.Optional(Type.Integer({ minimum: 0 })),
  status: Type.Union([
    Type.Literal("native"), Type.Literal("headless"), Type.Literal("adapter"), Type.Literal("partial"),
    Type.Literal("tui-only"), Type.Literal("unsupported")
  ]),
  detail: Type.String({ maxLength: MAX_EXTENSION_COMPATIBILITY_DETAIL_LENGTH })
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
