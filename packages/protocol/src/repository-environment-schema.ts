import {
  MAX_REPOSITORY_WORKTREES
} from "@pi67/domain";
import { Type, type TProperties } from "./typebox-schema.js";

const WorkspaceIdSchema = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: "^[A-Za-z0-9._:-]+$"
});
const PathSchema = Type.String({
  minLength: 1,
  maxLength: 32_768,
  pattern: "^(?!.*\\x00)(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\[^\\\\]+\\\\[^\\\\]+)"
});
const DecimalBigintSchema = Type.String({ minLength: 1, maxLength: 40, pattern: "^(?:0|[1-9][0-9]*)$" });
const WorkspaceIdentitySchema = Type.Union([
  strictObject({
    canonicalPath: PathSchema,
    device: DecimalBigintSchema,
    inode: DecimalBigintSchema,
    birthtimeNs: Type.Optional(DecimalBigintSchema),
    assurance: Type.Literal("filesystem")
  }),
  strictObject({
    canonicalPath: PathSchema,
    device: Type.Optional(DecimalBigintSchema),
    inode: Type.Optional(DecimalBigintSchema),
    birthtimeNs: Type.Optional(DecimalBigintSchema),
    assurance: Type.Literal("path-only")
  })
]);
const WorkspaceDescriptorSchema = strictObject({
  id: WorkspaceIdSchema,
  displayName: Type.String({ minLength: 1, maxLength: 1_024 }),
  identity: WorkspaceIdentitySchema,
  lastVerifiedAt: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  trust: Type.Union([Type.Literal("unknown"), Type.Literal("trusted"), Type.Literal("untrusted")]),
  trustProvenance: Type.Union([
    Type.Literal("native-picker"), Type.Literal("user-confirmed"), Type.Literal("restored"),
    Type.Literal("identity-changed"), Type.Literal("indirect")
  ]),
  availability: Type.Union([
    Type.Literal("available"), Type.Literal("missing"), Type.Literal("identity-changed"),
    Type.Literal("needs-confirmation"), Type.Literal("unavailable")
  ])
});

const EnvironmentErrorSchema = strictObject({
  stage: Type.Union([
    Type.Literal("workspace"),
    Type.Literal("toolchain"),
    Type.Literal("repository-root"),
    Type.Literal("common-dir"),
    Type.Literal("worktree-list"),
    Type.Literal("submodule-status"),
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

const RepositorySubmoduleObservationSchema = strictObject({
  status: Type.Union([
    Type.Literal("not-configured"),
    Type.Literal("complete"),
    Type.Literal("incomplete"),
    Type.Literal("conflicted")
  ]),
  total: Type.Integer({ minimum: 0, maximum: 10_000 }),
  uninitialized: Type.Integer({ minimum: 0, maximum: 10_000 }),
  divergent: Type.Integer({ minimum: 0, maximum: 10_000 }),
  conflicted: Type.Integer({ minimum: 0, maximum: 10_000 }),
  networkActionRequired: Type.Boolean()
});

const RepositoryWorktreeRecoverySchema = strictObject({
  kind: Type.Literal("app-owned-worktree"),
  action: Type.Literal("recreate-committed-state"),
  unrecoverableData: Type.Literal("uncommitted-and-untracked")
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

export const RepositoryChangeDetailRequestSchema = strictObject({
  workspaceId: WorkspaceIdSchema,
  revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  changeId: Type.String({ pattern: "^chg_[0-9a-f]{32}$" })
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
    submodules: Type.Optional(RepositorySubmoduleObservationSchema),
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
    recovery: Type.Optional(RepositoryWorktreeRecoverySchema),
    error: EnvironmentErrorSchema
  })
]);

export const RepositorySubmoduleInitializationRequestSchema = strictObject({
  workspaceId: WorkspaceIdSchema,
  mode: Type.Literal("network-explicit")
});

export const RepositorySubmoduleInitializationResultSchema = Type.Union([
  strictObject({
    status: Type.Union([Type.Literal("initialized"), Type.Literal("incomplete")]),
    submodules: RepositorySubmoduleObservationSchema
  }),
  strictObject({
    status: Type.Literal("rejected"),
    error: Type.Union([
      Type.Literal("invalid-request"),
      Type.Literal("workspace-unavailable"),
      Type.Literal("repository-stale"),
      Type.Literal("git-failed"),
      Type.Literal("internal")
    ])
  })
]);

export const AppOwnedWorktreeRecoveryRequestSchema = strictObject({
  workspaceId: WorkspaceIdSchema,
  confirmation: Type.Literal("recreate-committed-state")
});

export const AppOwnedWorktreeRecoveryResultSchema = Type.Union([
  strictObject({
    status: Type.Literal("recovered"),
    workspace: WorkspaceDescriptorSchema
  }),
  strictObject({
    status: Type.Literal("rejected"),
    error: Type.Union([
      Type.Literal("invalid-request"),
      Type.Literal("not-app-owned"),
      Type.Literal("identity-changed"),
      Type.Literal("not-recoverable"),
      Type.Literal("git-failed"),
      Type.Literal("internal")
    ]),
    recoverable: Type.Boolean()
  })
]);

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
