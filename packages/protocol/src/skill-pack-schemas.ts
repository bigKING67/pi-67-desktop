import { Type } from "./typebox-schema.js";

const SkillPackIdSchema = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: "^[A-Za-z0-9._:-]+$"
});
const SkillPackTextSchema = (maximum: number) => Type.String({
  minLength: 1,
  maxLength: maximum,
  pattern: "^(?![\\s\\S]*[\\u0000-\\u001F\\u007F])(?=[\\s\\S]*\\S)[\\s\\S]+$"
});

export const SkillPackTargetSchema = strictObject({ id: SkillPackIdSchema });

const SkillPackEntrySchema = strictObject({
  id: SkillPackIdSchema,
  suiteId: SkillPackIdSchema,
  displayName: SkillPackTextSchema(200),
  description: SkillPackTextSchema(500),
  manager: Type.Union([Type.Literal("lark-cli"), Type.Literal("pi67-desktop")]),
  updateOwner: Type.Union([Type.Literal("managed-pack"), Type.Literal("desktop")]),
  updateStatus: Type.Union([
    Type.Literal("not-checked"),
    Type.Literal("current"),
    Type.Literal("update-available"),
    Type.Literal("application-managed"),
    Type.Literal("modified"),
    Type.Literal("unavailable")
  ]),
  localState: Type.Union([
    Type.Literal("clean"), Type.Literal("modified"), Type.Literal("unknown")
  ]),
  provenance: Type.Union([Type.Literal("verified"), Type.Literal("unverified")]),
  installed: Type.Boolean(),
  installedSkillCount: Type.Integer({ minimum: 0, maximum: 256 }),
  skillIds: Type.Array(SkillPackIdSchema, { maxItems: 256 }),
  canUpdate: Type.Boolean(),
  effectiveSource: Type.Union([Type.Literal("bundled"), Type.Literal("managed")]),
  canRestore: Type.Boolean(),
  baselineVersion: Type.Optional(SkillPackTextSchema(100)),
  installedVersion: Type.Optional(SkillPackTextSchema(100)),
  installedSkillVersion: Type.Optional(SkillPackTextSchema(100)),
  latestVersion: Type.Optional(SkillPackTextSchema(100)),
  registryCommit: Type.Optional(Type.String({
    minLength: 40,
    maxLength: 64,
    pattern: "^[a-f0-9]+$"
  })),
  source: Type.Optional(SkillPackTextSchema(500)),
  detail: Type.Optional(SkillPackTextSchema(500))
});

export const SkillPackListResultSchema = strictObject({
  items: Type.Array(SkillPackEntrySchema, { maxItems: 64 }),
  total: Type.Integer({ minimum: 0, maximum: 64 }),
  checkedAt: Type.Optional(Type.Integer({ minimum: 0 }))
});

export const SkillPackMutationResultSchema = strictObject({
  items: Type.Array(SkillPackEntrySchema, { maxItems: 64 }),
  total: Type.Integer({ minimum: 0, maximum: 64 }),
  checkedAt: Type.Optional(Type.Integer({ minimum: 0 })),
  changed: Type.Boolean()
});

function strictObject<T extends Parameters<typeof Type.Object>[0]>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
