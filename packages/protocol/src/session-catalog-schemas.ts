import { Type, type TProperties } from "typebox";
import {
  MAX_SESSION_CATALOG_ID_CHARS,
  MAX_SESSION_CATALOG_NAME_CHARS,
  MAX_SESSION_CATALOG_PAGE_ITEMS,
  MAX_SESSION_CATALOG_PATH_CHARS,
  MAX_SESSION_CATALOG_SEARCH_CHARS,
  SESSION_CATALOG_QUERY_KEY_CHARS
} from "@pi67/domain";

const RevisionSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const TimestampSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const CatalogPathSchema = Type.String({ minLength: 1, maxLength: MAX_SESSION_CATALOG_PATH_CHARS });

const SessionCatalogCursorSchema = strictObject({
  revision: RevisionSchema,
  queryKey: Type.String({
    minLength: SESSION_CATALOG_QUERY_KEY_CHARS,
    maxLength: SESSION_CATALOG_QUERY_KEY_CHARS,
    pattern: "^[0-9a-f]+$"
  }),
  modifiedAt: TimestampSchema,
  path: CatalogPathSchema
});

export const SessionCatalogQuerySchema = strictObject({
  scope: Type.Union([Type.Literal("workspace"), Type.Literal("all")]),
  search: Type.Optional(Type.String({ maxLength: MAX_SESSION_CATALOG_SEARCH_CHARS })),
  cursor: Type.Optional(SessionCatalogCursorSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_SESSION_CATALOG_PAGE_ITEMS })),
  refresh: Type.Optional(Type.Boolean())
});

const SessionSummarySchema = strictObject({
  id: Type.String({ minLength: 1, maxLength: MAX_SESSION_CATALOG_ID_CHARS }),
  path: CatalogPathSchema,
  cwd: CatalogPathSchema,
  name: Type.String({ minLength: 1, maxLength: MAX_SESSION_CATALOG_NAME_CHARS }),
  modifiedAt: TimestampSchema,
  messageCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  parentSessionPath: Type.Optional(CatalogPathSchema)
});

const SessionCatalogSourceSchema = Type.Union([
  Type.Literal("sqlite"),
  Type.Literal("sdk-fallback")
]);
const SessionCatalogStateSchema = Type.Union([
  Type.Literal("ready"),
  Type.Literal("rebuilding"),
  Type.Literal("fallback"),
  Type.Literal("unavailable")
]);
const SessionCatalogDegradedReasonSchema = Type.Union([
  Type.Literal("busy"),
  Type.Literal("unavailable"),
  Type.Literal("runtime-load"),
  Type.Literal("storage-prepare"),
  Type.Literal("storage-inspect"),
  Type.Literal("database-open"),
  Type.Literal("database-verify"),
  Type.Literal("schema-prepare"),
  Type.Literal("recovery-prepare"),
  Type.Literal("recovery-open"),
  Type.Literal("recovery-verify"),
  Type.Literal("recovery-schema"),
  Type.Literal("runtime-query")
]);

const SessionCatalogStatusProperties = {
  revision: RevisionSchema,
  itemCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  source: SessionCatalogSourceSchema,
  state: SessionCatalogStateSchema,
  rebuilding: Type.Boolean(),
  degradedReason: Type.Optional(SessionCatalogDegradedReasonSchema),
  reconciledAt: Type.Optional(TimestampSchema),
  incomplete: Type.Boolean(),
  skippedCount: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
};

export const SessionCatalogStatusSchema = strictObject(SessionCatalogStatusProperties);

export const SessionCatalogPageSchema = strictObject({
  items: Type.Array(SessionSummarySchema, { maxItems: MAX_SESSION_CATALOG_PAGE_ITEMS }),
  total: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  hasMore: Type.Boolean(),
  nextCursor: Type.Optional(SessionCatalogCursorSchema),
  ...SessionCatalogStatusProperties
});

export const SessionCatalogChangedSchema = strictObject({
  revision: RevisionSchema,
  reason: Type.Union([
    Type.Literal("reconciled"),
    Type.Literal("session-created"),
    Type.Literal("session-updated"),
    Type.Literal("session-imported"),
    Type.Literal("source-changed")
  ])
});

export function hasBoundSessionCatalogCursor(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const page = value as { revision?: unknown; nextCursor?: { revision?: unknown } };
  return page.nextCursor === undefined || page.nextCursor.revision === page.revision;
}

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
