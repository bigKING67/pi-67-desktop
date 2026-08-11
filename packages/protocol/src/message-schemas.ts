import { Type, type TProperties } from "./typebox-schema.js";
import {
  MAX_MESSAGE_SEARCH_QUERY_CHARS,
  MAX_MESSAGE_SEARCH_RESULTS,
  MAX_MESSAGE_SEARCH_SNIPPET_CHARS,
  MAX_PLAN_MARKDOWN_CHARS,
  MAX_SESSION_CATALOG_NAME_CHARS,
  MAX_SESSION_CATALOG_PATH_CHARS,
  MAX_SESSION_FILE_IDENTITY_CHARS,
  MAX_WORKSPACE_MESSAGE_SEARCH_RESULTS,
  MAX_USER_MESSAGE_INDEX_PAGE_ITEMS,
  MAX_USER_MESSAGE_PREVIEW_CHARS,
  MAX_PROJECTED_MESSAGE_PARTS,
  MAX_PROJECTED_TEXT_BYTES
} from "@pi67/domain";
import { AssetReferenceSchema } from "./asset-schemas.js";
import { ExtensionToolAdapterSchema } from "./extension-catalog-schemas.js";
import { ToolExecutionSchema, ToolExecutionStatusSchema } from "./operation-schemas.js";

const TextPartSchema = messageObject({
  type: Type.Union([Type.Literal("text"), Type.Literal("thinking")]),
  text: Type.String({ maxLength: MAX_PROJECTED_TEXT_BYTES })
});
const ToolCallPartSchema = messageObject({
  type: Type.Literal("tool-call"),
  id: Type.String(),
  name: Type.String(),
  status: ToolExecutionStatusSchema,
  summary: Type.Optional(Type.String()),
  execution: Type.Optional(ToolExecutionSchema),
  adapter: Type.Optional(ExtensionToolAdapterSchema)
});
const ImagePartSchema = messageObject({
  type: Type.Literal("image"),
  mimeType: Type.Union([
    Type.Literal("image/png"),
    Type.Literal("image/jpeg"),
    Type.Literal("image/webp"),
    Type.Literal("image/gif")
  ]),
  asset: Type.Optional(AssetReferenceSchema),
  name: Type.Optional(Type.String({ maxLength: 512 }))
});
const AttachmentPartSchema = messageObject({
  type: Type.Literal("attachment"),
  id: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }),
  name: Type.String({ minLength: 1, maxLength: 512 }),
  mimeType: Type.String({ minLength: 1, maxLength: 128 }),
  byteLength: Type.Integer({ minimum: 0 }),
  kind: Type.Union([
    Type.Literal("document"),
    Type.Literal("archive"),
    Type.Literal("audio"),
    Type.Literal("video"),
    Type.Literal("file")
  ])
});
const PlanProposalPartSchema = messageObject({
  type: Type.Literal("plan-proposal"),
  plan: messageObject({
    entryId: Type.String({ minLength: 1, maxLength: 512 }),
    planId: Type.String({ minLength: 1, maxLength: 128 }),
    sourceOperationId: Type.String({ minLength: 1, maxLength: 512 }),
    markdown: Type.String({ minLength: 1, maxLength: MAX_PLAN_MARKDOWN_CHARS }),
    createdAt: Type.Integer({ minimum: 0 }),
    status: Type.Union([
      Type.Literal("proposed"),
      Type.Literal("implemented"),
      Type.Literal("dismissed")
    ])
  })
});
const MessagePartSchema = Type.Union([
  TextPartSchema,
  ToolCallPartSchema,
  ImagePartSchema,
  AttachmentPartSchema,
  PlanProposalPartSchema
]);

export const SessionMessageSchema = messageObject({
  id: Type.String(),
  role: Type.Union([Type.Literal("user"), Type.Literal("assistant"), Type.Literal("tool"), Type.Literal("system")]),
  parts: Type.Array(MessagePartSchema, { maxItems: MAX_PROJECTED_MESSAGE_PARTS }),
  createdAt: Type.Optional(Type.Number()),
  model: Type.Optional(Type.String()),
  toolName: Type.Optional(Type.String({ maxLength: 128 })),
  stopped: Type.Optional(Type.Boolean()),
  error: Type.Optional(Type.String())
});

export const MessagePageMetadataSchema = messageObject({
  startCursor: Type.Optional(Type.String()),
  endCursor: Type.Optional(Type.String()),
  hasOlder: Type.Boolean(),
  hasNewer: Type.Boolean()
});

export const ConversationPageSchema = messageObject({
  sessionId: Type.String(),
  messages: Type.Array(SessionMessageSchema, { maxItems: 200 }),
  startCursor: Type.Optional(Type.String()),
  endCursor: Type.Optional(Type.String()),
  hasOlder: Type.Boolean(),
  hasNewer: Type.Boolean()
});

const UserMessageIndexItemSchema = messageObject({
  id: Type.String({ minLength: 1, maxLength: 512 }),
  ordinal: Type.Integer({ minimum: 1 }),
  preview: Type.String({ maxLength: MAX_USER_MESSAGE_PREVIEW_CHARS }),
  createdAt: Type.Optional(Type.Number()),
  imageCount: Type.Integer({ minimum: 0 }),
  attachmentCount: Type.Integer({ minimum: 0 })
});

export const UserMessageIndexPageSchema = messageObject({
  sessionId: Type.String({ minLength: 1, maxLength: 512 }),
  revision: Type.Integer({ minimum: 1 }),
  total: Type.Integer({ minimum: 0 }),
  offset: Type.Integer({ minimum: 0 }),
  items: Type.Array(UserMessageIndexItemSchema, { maxItems: MAX_USER_MESSAGE_INDEX_PAGE_ITEMS })
});

const MessageSearchItemSchema = messageObject({
  id: Type.String({ minLength: 1, maxLength: 512 }),
  role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
  snippet: Type.String({ maxLength: MAX_MESSAGE_SEARCH_SNIPPET_CHARS }),
  createdAt: Type.Optional(Type.Number())
});

export const MessageSearchResultSchema = messageObject({
  sessionId: Type.String({ minLength: 1, maxLength: 512 }),
  revision: Type.Integer({ minimum: 1 }),
  query: Type.String({ minLength: 1, maxLength: MAX_MESSAGE_SEARCH_QUERY_CHARS }),
  total: Type.Integer({ minimum: 0 }),
  items: Type.Array(MessageSearchItemSchema, { maxItems: MAX_MESSAGE_SEARCH_RESULTS }),
  truncated: Type.Boolean()
});

const WorkspaceMessageSearchItemSchema = messageObject({
  sessionFileIdentity: Type.String({ minLength: 1, maxLength: MAX_SESSION_FILE_IDENTITY_CHARS }),
  sessionPath: Type.String({ minLength: 1, maxLength: MAX_SESSION_CATALOG_PATH_CHARS }),
  sessionName: Type.String({ minLength: 1, maxLength: MAX_SESSION_CATALOG_NAME_CHARS }),
  messageId: Type.String({ minLength: 1, maxLength: 512 }),
  role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
  snippet: Type.String({ maxLength: MAX_MESSAGE_SEARCH_SNIPPET_CHARS }),
  createdAt: Type.Optional(Type.Number())
});

export const WorkspaceMessageSearchResultSchema = messageObject({
  workspaceId: Type.String({ minLength: 1, maxLength: 512 }),
  query: Type.String({ minLength: 1, maxLength: MAX_MESSAGE_SEARCH_QUERY_CHARS }),
  items: Type.Array(WorkspaceMessageSearchItemSchema, { maxItems: MAX_WORKSPACE_MESSAGE_SEARCH_RESULTS }),
  sessionsVisited: Type.Integer({ minimum: 0 }),
  entriesVisited: Type.Integer({ minimum: 0 }),
  skippedCount: Type.Integer({ minimum: 0 }),
  incomplete: Type.Boolean(),
  truncated: Type.Boolean()
});

export const LocatedMessageWindowSchema = messageObject({
  sessionId: Type.String(),
  messages: Type.Array(SessionMessageSchema, { maxItems: 200 }),
  startCursor: Type.Optional(Type.String()),
  endCursor: Type.Optional(Type.String()),
  hasOlder: Type.Boolean(),
  hasNewer: Type.Boolean(),
  anchorId: Type.String({ minLength: 1, maxLength: 512 }),
  revision: Type.Integer({ minimum: 1 })
});

function messageObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
