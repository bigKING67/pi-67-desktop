import { MAX_TREE_NODES } from "@pi67/domain";
import { Type } from "./typebox-schema.js";

const SessionTreeNodeSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 512 }),
  parentId: Type.Union([Type.String({ minLength: 1, maxLength: 512 }), Type.Null()]),
  type: Type.String({ minLength: 1, maxLength: 64 }),
  label: Type.Optional(Type.String({ maxLength: 256 })),
  preview: Type.String({ maxLength: 512 }),
  active: Type.Boolean(),
  depth: Type.Integer({ minimum: 0 })
}, { additionalProperties: false });

export const SessionTreeProjectionSchema = Type.Object({
  nodes: Type.Array(SessionTreeNodeSchema, { maxItems: MAX_TREE_NODES }),
  truncated: Type.Boolean(),
  total: Type.Integer({ minimum: 0 })
}, { additionalProperties: false });
