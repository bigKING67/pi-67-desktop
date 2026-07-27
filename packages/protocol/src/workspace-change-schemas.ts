import {
  MAX_WORKSPACE_CHANGES,
  MAX_WORKSPACE_CHANGE_PATCH_BYTES,
  MAX_WORKSPACE_CHANGE_PATH_BYTES
} from "@pi67/domain";
import { Type, type TProperties } from "typebox";

const WorkspaceChangeBaseSchema = {
  toolCallId: Type.String({ minLength: 1, maxLength: 512 }),
  path: Type.String({ minLength: 1, maxLength: MAX_WORKSPACE_CHANGE_PATH_BYTES }),
  pathTruncated: Type.Boolean(),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("running"),
    Type.Literal("completed"),
    Type.Literal("failed"),
    Type.Literal("interrupted")
  ])
};

const EditWorkspaceChangeSchema = strictObject({
  ...WorkspaceChangeBaseSchema,
  kind: Type.Literal("edit"),
  patch: Type.Optional(Type.String({ maxLength: MAX_WORKSPACE_CHANGE_PATCH_BYTES })),
  patchTruncated: Type.Boolean(),
  additions: Type.Optional(Type.Integer({ minimum: 0 })),
  deletions: Type.Optional(Type.Integer({ minimum: 0 })),
  firstChangedLine: Type.Optional(Type.Integer({ minimum: 0 }))
});

const WriteWorkspaceChangeSchema = strictObject({
  ...WorkspaceChangeBaseSchema,
  kind: Type.Literal("write"),
  writtenBytes: Type.Optional(Type.Integer({ minimum: 0 })),
  writtenLines: Type.Optional(Type.Integer({ minimum: 0 })),
  metricsTruncated: Type.Boolean()
});

const WorkspaceChangeSchema = Type.Union([EditWorkspaceChangeSchema, WriteWorkspaceChangeSchema]);

export const WorkspaceChangesProjectionSchema = strictObject({
  sessionId: Type.String({ minLength: 1, maxLength: 512 }),
  items: Type.Array(WorkspaceChangeSchema, { maxItems: MAX_WORKSPACE_CHANGES }),
  truncated: Type.Boolean(),
  total: Type.Integer({ minimum: 0 })
});

export const WorkspaceChangeEventSchema = strictObject({
  sessionId: Type.String({ minLength: 1, maxLength: 512 }),
  change: WorkspaceChangeSchema
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
