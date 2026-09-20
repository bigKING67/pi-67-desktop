import { strictObject, Type } from "./typebox-schema.js";
import { MAX_RESOURCE_CATALOG_ITEMS, MAX_SESSION_FILE_IDENTITY_CHARS } from "@pi67/domain";
import { SessionCompatibilityViewSchema } from "./session-compatibility-schemas.js";
import { SessionTreeProjectionSchema } from "./session-tree-schemas.js";
import { MessagePageMetadataSchema, SessionMessageSchema } from "./message-schemas.js";
import { ModelSummarySchema, ProviderSummarySchema } from "./session-control-schemas.js";
import { ResourceCatalogDispositionSchema, ResourceSummarySchema } from "./session-resource-schemas.js";
import { ActiveProposedPlanSchema, PlanLifecycleChangeSchema, SessionInteractionModeSchema } from "./session-plan-schemas.js";

export const SessionSnapshotSchema = strictObject({
  sessionId: Type.String(),
  memoryOrigin: Type.Optional(Type.Union([
    strictObject({ kind: Type.Literal("private") }),
    strictObject({ kind: Type.Literal("unverified") }),
    strictObject({ kind: Type.Literal("team"),
      teamId: Type.String({ minLength: 1, maxLength: 128, pattern: "^\\S+$" }),
      projectId: Type.String({ minLength: 1, maxLength: 128, pattern: "^\\S+$" }) })
  ])),
  sessionFileIdentity: Type.Optional(Type.String({
    minLength: 1,
    maxLength: MAX_SESSION_FILE_IDENTITY_CHARS
  })),
  sessionPath: Type.Optional(Type.String()),
  sessionName: Type.Optional(Type.String()),
  cwd: Type.String(),
  streaming: Type.Boolean(),
  messages: Type.Array(SessionMessageSchema, { maxItems: 100 }),
  messagePage: MessagePageMetadataSchema,
  models: Type.Array(ModelSummarySchema),
  providers: Type.Array(ProviderSummarySchema),
  selectedModel: Type.Optional(strictObject({ provider: Type.String(), id: Type.String() })),
  thinkingLevel: Type.String(),
  availableThinkingLevels: Type.Array(Type.String()),
  steeringQueue: Type.Array(Type.String()),
  followUpQueue: Type.Array(Type.String()),
  tree: SessionTreeProjectionSchema,
  resources: Type.Array(ResourceSummarySchema, { maxItems: MAX_RESOURCE_CATALOG_ITEMS }),
  resourceCatalog: Type.Optional(ResourceCatalogDispositionSchema),
  interactionMode: Type.Optional(SessionInteractionModeSchema),
  activeProposedPlan: Type.Optional(ActiveProposedPlanSchema),
  planLifecycle: Type.Optional(PlanLifecycleChangeSchema),
  compatibility: Type.Optional(SessionCompatibilityViewSchema),
  stats: Type.Optional(strictObject({
    tokens: Type.Number(),
    cost: Type.Number(),
    contextPercent: Type.Optional(Type.Number())
  }))
});
