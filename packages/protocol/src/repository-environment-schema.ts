import { MAX_REPOSITORY_WORKTREES } from "@pi67/domain";
import { Type, type TProperties } from "./typebox-schema.js";

const WorkspaceIdSchema = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: "^[A-Za-z0-9._:-]+$"
});

const EnvironmentErrorSchema = strictObject({
  stage: Type.Union([
    Type.Literal("workspace"),
    Type.Literal("toolchain"),
    Type.Literal("repository-root"),
    Type.Literal("common-dir"),
    Type.Literal("worktree-list"),
    Type.Literal("identity"),
    Type.Literal("state"),
    Type.Literal("catalog")
  ]),
  code: Type.Union([
    Type.Literal("workspace-not-found"),
    Type.Literal("workspace-unavailable"),
    Type.Literal("toolchain-unavailable"),
    Type.Literal("not-a-repository"),
    Type.Literal("timeout"),
    Type.Literal("output-limit"),
    Type.Literal("process-failed"),
    Type.Literal("invalid-output"),
    Type.Literal("identity-unavailable"),
    Type.Literal("state-unavailable"),
    Type.Literal("catalog-unavailable"),
    Type.Literal("unknown")
  ]),
  recoverable: Type.Boolean()
});

const WorktreeObservationSchema = strictObject({
  worktreeId: Type.String({ pattern: "^wt_[0-9a-f]{32}$" }),
  workspaceId: Type.Optional(WorkspaceIdSchema),
  kind: Type.Union([Type.Literal("primary"), Type.Literal("linked")]),
  status: Type.Union([Type.Literal("ready"), Type.Literal("missing"), Type.Literal("prunable")]),
  branchName: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  headSha: Type.Optional(Type.String({ pattern: "^[0-9a-f]{40}$" })),
  detached: Type.Boolean(),
  locked: Type.Boolean()
});

const SnapshotBase = {
  workspaceId: WorkspaceIdSchema,
  revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  observedAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  stale: Type.Boolean()
};

const EmptyWorktreesSchema = Type.Array(WorktreeObservationSchema, { maxItems: 0 });
const WorktreesSchema = Type.Array(WorktreeObservationSchema, { maxItems: MAX_REPOSITORY_WORKTREES });

export const RepositoryEnvironmentInspectionRequestSchema = strictObject({
  workspaceId: WorkspaceIdSchema
});

export const RepositoryEnvironmentSnapshotSchema = Type.Union([
  strictObject({
    ...SnapshotBase,
    status: Type.Literal("ready"),
    repository: strictObject({
      repositoryGroupId: Type.String({ pattern: "^repo_[0-9a-f]{32}$" }),
      assurance: Type.Union([Type.Literal("filesystem"), Type.Literal("path-only")]),
      currentWorktreeId: Type.String({ pattern: "^wt_[0-9a-f]{32}$" })
    }),
    worktrees: WorktreesSchema,
    error: Type.Optional(EnvironmentErrorSchema)
  }),
  strictObject({
    ...SnapshotBase,
    status: Type.Literal("non-git"),
    worktrees: EmptyWorktreesSchema,
    error: Type.Optional(EnvironmentErrorSchema)
  }),
  strictObject({
    ...SnapshotBase,
    status: Type.Union([
      Type.Literal("toolchain-unavailable"),
      Type.Literal("missing"),
      Type.Literal("error")
    ]),
    worktrees: EmptyWorktreesSchema,
    error: EnvironmentErrorSchema
  })
]);

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
