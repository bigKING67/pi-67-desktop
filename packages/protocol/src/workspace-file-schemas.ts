import {
  MAX_WORKSPACE_FILE_CONTENT_BYTES,
  MAX_WORKSPACE_FILE_NAME_CHARS,
  MAX_WORKSPACE_FILE_PAGE_ITEMS,
  MAX_WORKSPACE_FILE_PATH_CHARS,
  MAX_WORKSPACE_FILE_QUERY_CHARS,
  MAX_WORKSPACE_FILE_SEARCH_RESULTS
} from "@pi67/domain";
import { Type, type TProperties } from "./typebox-schema.js";

const OpaqueFileIdSchema = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" });
const OpaqueFileRevisionSchema = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" });
const WorkspaceFileKindSchema = Type.Union([
  Type.Literal("directory"),
  Type.Literal("file"),
  Type.Literal("symlink"),
  Type.Literal("other")
]);
const WorkspaceFileEntrySchema = strictObject({
  id: OpaqueFileIdSchema,
  name: Type.String({ minLength: 1, maxLength: 4_096 }),
  relativePath: Type.String({ minLength: 1, maxLength: MAX_WORKSPACE_FILE_PATH_CHARS }),
  kind: WorkspaceFileKindSchema,
  revision: OpaqueFileRevisionSchema,
  byteLength: Type.Optional(Type.Integer({ minimum: 0 })),
  modifiedAt: Type.Optional(Type.Integer({ minimum: 0 }))
});

export const WorkspaceFileListPayloadSchema = strictObject({
  parentId: Type.Optional(OpaqueFileIdSchema),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_WORKSPACE_FILE_PAGE_ITEMS }))
});

export const WorkspaceFileSearchPayloadSchema = strictObject({
  query: Type.String({ minLength: 1, maxLength: MAX_WORKSPACE_FILE_QUERY_CHARS }),
  includeGenerated: Type.Optional(Type.Boolean())
});

export const WorkspaceFileResolvePayloadSchema = strictObject({
  relativePath: Type.String({ minLength: 1, maxLength: MAX_WORKSPACE_FILE_PATH_CHARS })
});

export const WorkspaceFileOpenPayloadSchema = strictObject({ id: OpaqueFileIdSchema });

export const WorkspaceFileSavePayloadSchema = strictObject({
  id: OpaqueFileIdSchema,
  expectedRevision: OpaqueFileRevisionSchema,
  content: Type.String({ maxLength: MAX_WORKSPACE_FILE_CONTENT_BYTES })
});

export const WorkspaceFileCreatePayloadSchema = strictObject({
  parentId: Type.Optional(OpaqueFileIdSchema),
  name: Type.String({ minLength: 1, maxLength: MAX_WORKSPACE_FILE_NAME_CHARS }),
  kind: Type.Union([Type.Literal("file"), Type.Literal("directory")])
});

export const WorkspaceFileRenamePayloadSchema = strictObject({
  id: OpaqueFileIdSchema,
  name: Type.String({ minLength: 1, maxLength: MAX_WORKSPACE_FILE_NAME_CHARS })
});

export const WorkspaceFilePageSchema = strictObject({
  workspaceId: Type.String({ minLength: 1, maxLength: 512 }),
  parentId: Type.Optional(OpaqueFileIdSchema),
  entries: Type.Array(WorkspaceFileEntrySchema, { maxItems: MAX_WORKSPACE_FILE_PAGE_ITEMS }),
  nextCursor: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
  truncated: Type.Boolean()
});

export const WorkspaceFileSearchResultSchema = strictObject({
  workspaceId: Type.String({ minLength: 1, maxLength: 512 }),
  query: Type.String({ minLength: 1, maxLength: MAX_WORKSPACE_FILE_QUERY_CHARS }),
  entries: Type.Array(WorkspaceFileEntrySchema, { maxItems: MAX_WORKSPACE_FILE_SEARCH_RESULTS }),
  truncated: Type.Boolean(),
  visited: Type.Integer({ minimum: 0 })
});

export const WorkspaceFileEntryResultSchema = strictObject({ entry: WorkspaceFileEntrySchema });

export const WorkspaceFileRenameResultSchema = strictObject({
  entry: WorkspaceFileEntrySchema,
  previousRelativePath: Type.String({ minLength: 1, maxLength: MAX_WORKSPACE_FILE_PATH_CHARS })
});

export const WorkspaceFileOpenResultSchema = strictObject({
  id: OpaqueFileIdSchema,
  relativePath: Type.String({ minLength: 1, maxLength: MAX_WORKSPACE_FILE_PATH_CHARS }),
  kind: Type.Union([
    Type.Literal("text"),
    Type.Literal("binary"),
    Type.Literal("oversized"),
    Type.Literal("unsupported")
  ]),
  totalBytes: Type.Integer({ minimum: 0 }),
  revision: OpaqueFileRevisionSchema,
  content: Type.Optional(Type.String({ maxLength: MAX_WORKSPACE_FILE_CONTENT_BYTES })),
  reason: Type.Optional(Type.String({ maxLength: 512 }))
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
