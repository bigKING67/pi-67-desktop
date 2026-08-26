import { Type, type TProperties } from "./typebox-schema.js";

const BoundedIdSchema = Type.String({ minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9._:-]+$" });
const PathSchema = Type.String({
  minLength: 1,
  maxLength: 32_768,
  pattern: "^(?!.*\\x00)(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\[^\\\\]+\\\\[^\\\\]+)"
});
const DecimalBigintSchema = Type.String({ minLength: 1, maxLength: 40, pattern: "^(?:0|[1-9][0-9]*)$" });
const SessionFileIdentitySchema = Type.String({
  minLength: 1,
  maxLength: 1_024,
  pattern: "^[^\\x00]{1,1024}$"
});

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
  id: BoundedIdSchema,
  displayName: Type.String({ minLength: 1, maxLength: 1_024 }),
  identity: WorkspaceIdentitySchema,
  lastVerifiedAt: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  trust: Type.Union([Type.Literal("unknown"), Type.Literal("trusted"), Type.Literal("untrusted")]),
  trustProvenance: Type.Union([
    Type.Literal("native-picker"),
    Type.Literal("user-confirmed"),
    Type.Literal("restored"),
    Type.Literal("identity-changed"),
    Type.Literal("indirect")
  ]),
  availability: Type.Union([
    Type.Literal("available"),
    Type.Literal("missing"),
    Type.Literal("identity-changed"),
    Type.Literal("needs-confirmation"),
    Type.Literal("unavailable")
  ])
});

const WorktreeCreationErrorSchema = strictObject({
  stage: Type.Union([
    Type.Literal("request"),
    Type.Literal("preflight"),
    Type.Literal("state"),
    Type.Literal("git"),
    Type.Literal("identity"),
    Type.Literal("rollback")
  ]),
  code: Type.Union([
    Type.Literal("invalid-request"),
    Type.Literal("workspace-not-found"),
    Type.Literal("workspace-unavailable"),
    Type.Literal("workspace-untrusted"),
    Type.Literal("repository-not-ready"),
    Type.Literal("repository-stale"),
    Type.Literal("state-unavailable"),
    Type.Literal("toolchain-unavailable"),
    Type.Literal("custom-filter"),
    Type.Literal("queue-full"),
    Type.Literal("repository-indeterminate"),
    Type.Literal("identity-collision"),
    Type.Literal("cancelled"),
    Type.Literal("git-failed"),
    Type.Literal("rollback-protected"),
    Type.Literal("recovery-required"),
    Type.Literal("internal")
  ]),
  recoverable: Type.Boolean()
});

export const WorktreeCreationRequestSchema = strictObject({
  requestId: BoundedIdSchema,
  creationId: BoundedIdSchema,
  sourceWorkspaceId: BoundedIdSchema
});

export const WorktreeCreationActivityRequestSchema = strictObject({ creationId: BoundedIdSchema });
export const WorktreeCreationCancelRequestSchema = strictObject({ creationId: BoundedIdSchema });

const WorktreeCreationActivitySchema = strictObject({
  creationId: BoundedIdSchema,
  stage: Type.Union([
    Type.Literal("preflight"),
    Type.Literal("queued"),
    Type.Literal("checkout"),
    Type.Literal("submodules"),
    Type.Literal("verifying"),
    Type.Literal("workspace-registering")
  ]),
  startedAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  updatedAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  budgetMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 600_000 })),
  cancellable: Type.Literal(true)
});

export const WorktreeCreationActivityResultSchema = Type.Union([
  strictObject({ status: Type.Literal("active"), activity: WorktreeCreationActivitySchema }),
  strictObject({ status: Type.Literal("inactive") })
]);

export const WorktreeCreationCancelResultSchema = Type.Union([
  strictObject({ status: Type.Literal("cancel-requested") }),
  strictObject({ status: Type.Literal("inactive") })
]);

const RepositorySubmoduleObservationSchema = strictObject({
  status: Type.Union([
    Type.Literal("not-configured"), Type.Literal("complete"),
    Type.Literal("incomplete"), Type.Literal("conflicted")
  ]),
  total: Type.Integer({ minimum: 0, maximum: 10_000 }),
  uninitialized: Type.Integer({ minimum: 0, maximum: 10_000 }),
  divergent: Type.Integer({ minimum: 0, maximum: 10_000 }),
  conflicted: Type.Integer({ minimum: 0, maximum: 10_000 }),
  networkActionRequired: Type.Boolean()
});

export const WorktreeCreationRollbackRequestSchema = strictObject({
  requestId: BoundedIdSchema,
  creationId: BoundedIdSchema,
  sourceWorkspaceId: BoundedIdSchema
});

export const WorktreeCreationAdvanceRequestSchema = Type.Union([
  strictObject({
    creationId: BoundedIdSchema,
    targetState: Type.Literal("session-bound"),
    sessionFileIdentity: SessionFileIdentitySchema
  }),
  strictObject({
    creationId: BoundedIdSchema,
    targetState: Type.Union([
      Type.Literal("workspace-registered"),
      Type.Literal("host-registering"),
      Type.Literal("host-registered"),
      Type.Literal("session-materializing"),
      Type.Literal("committed")
    ])
  })
]);

export const WorktreeCreationResultSchema = Type.Union([
  strictObject({
    status: Type.Literal("created"),
    receipt: strictObject({
      requestId: BoundedIdSchema,
      creationId: BoundedIdSchema,
      sourceWorkspaceId: BoundedIdSchema,
      repositoryGroupId: Type.String({ pattern: "^repo_[0-9a-f]{32}$" }),
      state: Type.Literal("workspace-registered"),
      workspace: WorkspaceDescriptorSchema,
      submodules: Type.Optional(RepositorySubmoduleObservationSchema)
    })
  }),
  strictObject({
    status: Type.Literal("rejected"),
    error: WorktreeCreationErrorSchema
  })
]);

export const WorktreeCreationAdvanceResultSchema = Type.Union([
  strictObject({
    status: Type.Literal("advanced"),
    receipt: Type.Union([
      strictObject({
        creationId: BoundedIdSchema,
        state: Type.Union([
          Type.Literal("workspace-registered"),
          Type.Literal("host-registering"),
          Type.Literal("host-registered"),
          Type.Literal("session-materializing")
        ]),
        workspaceId: BoundedIdSchema
      }),
      strictObject({
        creationId: BoundedIdSchema,
        state: Type.Union([Type.Literal("session-bound"), Type.Literal("committed")]),
        workspaceId: BoundedIdSchema,
        sessionFileIdentity: SessionFileIdentitySchema
      })
    ])
  }),
  strictObject({
    status: Type.Literal("rejected"),
    error: WorktreeCreationErrorSchema
  })
]);

export const WorktreeCreationRollbackResultSchema = Type.Union([
  strictObject({
    status: Type.Literal("rolled-back"),
    receipt: strictObject({
      requestId: BoundedIdSchema,
      creationId: BoundedIdSchema,
      sourceWorkspaceId: BoundedIdSchema,
      state: Type.Literal("rolled-back")
    })
  }),
  strictObject({
    status: Type.Literal("rejected"),
    error: WorktreeCreationErrorSchema
  })
]);

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
