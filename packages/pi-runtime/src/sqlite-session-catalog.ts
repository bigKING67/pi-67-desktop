import { rename } from "node:fs/promises";
import { join } from "node:path";
import type { SessionCatalogDegradedReason } from "@pi67/domain";
import {
  configureCatalogDatabase,
  CorruptCatalogError,
  createCatalogSchema,
  SchemaMismatchError,
  stateFromRow,
  validateCatalogDatabase,
  type DatabaseConstructor,
  type DatabaseLike
} from "./sqlite-session-catalog-schema.js";
import type { SessionCatalogOrganization } from "./sqlite-session-catalog-organization.js";
import {
  querySqliteSessionCatalog,
  type SqliteCatalogQuery,
  type SqliteCatalogQueryResult
} from "./sqlite-session-catalog-query.js";
import {
  enforcePrivateSessionCatalogPermissions,
  prepareSessionCatalogDirectory,
  removeSessionCatalogRecovery,
  sessionCatalogFileExists,
  type SessionCatalogPermissionOperations
} from "./session-catalog-storage.js";
import {
  SqliteSessionContentIndex,
  type SessionContentIndexCandidate,
  type SessionContentIndexCoverage,
  type SessionContentIndexDocument
} from "./sqlite-session-content-index.js";
import { SqliteSessionCatalogMutations } from "./sqlite-session-catalog-mutations.js";
import type {
  SessionCatalogRecord,
  SqliteCatalogState
} from "./sqlite-session-catalog-contract.js";

export type {
  SessionCatalogRecord,
  SqliteCatalogState
} from "./sqlite-session-catalog-contract.js";

export type {
  SessionContentIndexCandidate,
  SessionContentIndexDocument,
  SessionContentIndexMessage
} from "./sqlite-session-content-index.js";

export type { SqliteCatalogQueryResult } from "./sqlite-session-catalog-query.js";

export const SESSION_CATALOG_DATABASE_FILENAME = "session-catalog-v3.sqlite3";
export const SESSION_CATALOG_RECOVERY_FILENAME = "session-catalog-v3.recovery.sqlite3";
const CATALOG_DATABASE_VERSION_SQL = `
  SELECT data.data_version, schema_version.schema_version
  FROM pragma_data_version() AS data
  CROSS JOIN pragma_schema_version() AS schema_version
`;

interface CatalogDatabaseVersion {
  dataVersion: number;
  schemaVersion: number;
}

export class SessionCatalogChangedExternallyError extends Error {
  readonly code = "SESSION_CATALOG_CHANGED_EXTERNALLY";
  readonly recoverable = true;

  constructor() {
    super("Session Catalog changed outside the active Pi runtime service.");
  }
}

export interface SqliteSessionCatalog {
  getState(): SqliteCatalogState;
  query(query: SqliteCatalogQuery): SqliteCatalogQueryResult;
  replaceAll(
    sourceKey: string,
    records: SessionCatalogRecord[],
    metadata: { reconciledAt: number; incomplete: boolean; skippedCount: number },
    minimumRevision: number
  ): SqliteCatalogState;
  preserveAutomaticNames?(sourceKey: string, records: SessionCatalogRecord[]): SessionCatalogRecord[];
  contentIndexSalt?(): string;
  contentIndexVersions?(): Map<string, string>;
  replaceContentIndex?(document: SessionContentIndexDocument): void;
  replaceContentIndexes?(documents: readonly SessionContentIndexDocument[]): void;
  removeContentIndex?(fileIdentity: string): void;
  pruneContentIndex?(fileIdentities: ReadonlySet<string>): void;
  queryContentIndex?(cwdKey: string, tokenHashes: readonly string[], limit: number): SessionContentIndexCandidate[];
  contentIndexCoverage?(cwdKey: string): SessionContentIndexCoverage;
  upsert(record: SessionCatalogRecord, minimumRevision: number): SqliteCatalogState;
  upsertMany(records: readonly SessionCatalogRecord[], minimumRevision: number): SqliteCatalogState;
  setIncomplete(incomplete: boolean, skippedCount: number): SqliteCatalogState;
  organize?(path: string, organization: SessionCatalogOrganization, minimumRevision: number): SqliteCatalogState;
  organizeMany?(
    organizations: readonly { path: string; organization: SessionCatalogOrganization }[],
    minimumRevision: number
  ): SqliteCatalogState;
  close(): void;
}

export type IndexedSqliteSessionCatalog = SqliteSessionCatalog & Required<Pick<
  SqliteSessionCatalog,
  | "contentIndexSalt"
  | "contentIndexVersions"
  | "replaceContentIndex"
  | "replaceContentIndexes"
  | "removeContentIndex"
  | "pruneContentIndex"
  | "queryContentIndex"
  | "contentIndexCoverage"
>>;

export function supportsSessionContentIndex(
  catalog: SqliteSessionCatalog
): catalog is IndexedSqliteSessionCatalog {
  return typeof catalog.contentIndexSalt === "function"
    && typeof catalog.contentIndexVersions === "function"
    && typeof catalog.replaceContentIndex === "function"
    && typeof catalog.replaceContentIndexes === "function"
    && typeof catalog.removeContentIndex === "function"
    && typeof catalog.pruneContentIndex === "function"
    && typeof catalog.queryContentIndex === "function"
    && typeof catalog.contentIndexCoverage === "function";
}

export type SqliteCatalogOpenResult =
  | { kind: "ready"; catalog: SqliteSessionCatalog }
  | {
      kind: "fallback";
      reason: "busy" | "unavailable";
      degradedReason?: Exclude<SessionCatalogDegradedReason, "runtime-query">;
    };

export type OpenSqliteSessionCatalog = (
  directory: string,
  expectedRoot?: string
) => Promise<SqliteCatalogOpenResult>;

export async function openSqliteSessionCatalog(
  directory: string,
  expectedRoot?: string,
  loadDatabase: () => Promise<DatabaseConstructor> = loadNodeSqlite,
  permissionOperations?: SessionCatalogPermissionOperations
): Promise<SqliteCatalogOpenResult> {
  let Database: DatabaseConstructor;
  try {
    Database = await loadDatabase();
  } catch {
    return fallback("unavailable", "runtime-load");
  }

  let canonicalDirectory: string;
  try {
    canonicalDirectory = await prepareSessionCatalogDirectory(directory, expectedRoot, permissionOperations);
  } catch {
    return fallback("unavailable", "storage-prepare");
  }

  const location = join(canonicalDirectory, SESSION_CATALOG_DATABASE_FILENAME);
  const recovery = join(canonicalDirectory, SESSION_CATALOG_RECOVERY_FILENAME);
  let exists: boolean;
  try {
    exists = await sessionCatalogFileExists(location);
  } catch {
    return fallback("unavailable", "storage-inspect");
  }
  let database: DatabaseLike | undefined;
  let stage: Exclude<SessionCatalogDegradedReason, "busy" | "unavailable" | "runtime-query"> = "database-open";
  try {
    if (exists) {
      stage = "database-verify";
      await enforcePrivateSessionCatalogPermissions(location, 0o600, "database", permissionOperations);
    }
    stage = "database-open";
    database = new Database(location);
    if (!exists) {
      stage = "database-verify";
      await sessionCatalogFileExists(location);
      await enforcePrivateSessionCatalogPermissions(location, 0o600, "database", permissionOperations);
    }
    stage = "schema-prepare";
    const openedVersion = prepareCatalogForUse(database, !exists);
    stage = "database-verify";
    await sessionCatalogFileExists(location);
    return { kind: "ready", catalog: new NodeSqliteSessionCatalog(database, recovery, openedVersion) };
  } catch (error) {
    safeClose(database);
    const failure = classifySqliteFailure(error);
    if (failure === "busy") return fallback("busy", "busy");
    if (failure !== "replaceable") return fallback("unavailable", stage);
  }

  stage = "recovery-prepare";
  try {
    await removeSessionCatalogRecovery(recovery);
    await sessionCatalogFileExists(location);
    await rename(location, recovery);
    await sessionCatalogFileExists(recovery);
    stage = "recovery-open";
    database = new Database(location);
    stage = "recovery-verify";
    await sessionCatalogFileExists(location);
    await enforcePrivateSessionCatalogPermissions(location, 0o600, "database", permissionOperations);
    stage = "recovery-schema";
    const openedVersion = prepareCatalogForUse(database, true);
    stage = "recovery-verify";
    await sessionCatalogFileExists(location);
    return { kind: "ready", catalog: new NodeSqliteSessionCatalog(database, recovery, openedVersion) };
  } catch (error) {
    safeClose(database);
    return classifySqliteFailure(error) === "busy"
      ? fallback("busy", "busy")
      : fallback("unavailable", stage);
  }
}

function fallback(
  reason: "busy" | "unavailable",
  degradedReason: Exclude<SessionCatalogDegradedReason, "runtime-query">
): SqliteCatalogOpenResult {
  return { kind: "fallback", reason, degradedReason };
}

class NodeSqliteSessionCatalog implements SqliteSessionCatalog {
  private closed = false;
  private readonly versionStatement: ReturnType<DatabaseLike["prepare"]>;
  private readonly contentIndex: SqliteSessionContentIndex;
  private readonly mutations: SqliteSessionCatalogMutations;

  constructor(
    private readonly database: DatabaseLike,
    private readonly recoveryPath: string,
    private readonly openedVersion: CatalogDatabaseVersion
  ) {
    this.versionStatement = database.prepare(CATALOG_DATABASE_VERSION_SQL);
    this.contentIndex = new SqliteSessionContentIndex(database, () => this.assertDatabaseVersion());
    this.mutations = new SqliteSessionCatalogMutations({
      database,
      recoveryPath,
      getState: () => this.getState(),
      readState: () => this.readState(),
      assertDatabaseVersion: () => this.assertDatabaseVersion()
    });
  }

  getState(): SqliteCatalogState {
    this.assertDatabaseVersion();
    const state = this.readState();
    this.assertDatabaseVersion();
    return state;
  }

  private readState(): SqliteCatalogState {
    const row = this.database.prepare(`
      SELECT source_key, revision, reconciled_at_ms, item_count, incomplete, skipped_count
      FROM catalog_state WHERE singleton = 1
    `).get();
    if (!row) throw new SchemaMismatchError("Catalog state is missing.");
    return stateFromRow(row);
  }

  query(query: SqliteCatalogQuery): SqliteCatalogQueryResult {
    this.assertDatabaseVersion();
    const result = querySqliteSessionCatalog(this.database, query);
    this.assertDatabaseVersion();
    return result;
  }

  contentIndexSalt(): string {
    return this.contentIndex.salt();
  }

  contentIndexVersions(): Map<string, string> {
    return this.contentIndex.versions();
  }

  replaceContentIndex(document: SessionContentIndexDocument): void {
    this.contentIndex.replace(document);
  }

  replaceContentIndexes(documents: readonly SessionContentIndexDocument[]): void {
    this.contentIndex.replaceMany(documents);
  }

  removeContentIndex(fileIdentity: string): void {
    this.contentIndex.remove(fileIdentity);
  }

  pruneContentIndex(fileIdentities: ReadonlySet<string>): void {
    this.contentIndex.prune(fileIdentities);
  }

  queryContentIndex(
    cwdKey: string,
    tokenHashes: readonly string[],
    limit: number
  ): SessionContentIndexCandidate[] {
    return this.contentIndex.query(cwdKey, tokenHashes, limit);
  }

  contentIndexCoverage(cwdKey: string): SessionContentIndexCoverage {
    return this.contentIndex.coverage(cwdKey);
  }

  replaceAll(
    sourceKey: string,
    records: SessionCatalogRecord[],
    metadata: { reconciledAt: number; incomplete: boolean; skippedCount: number },
    minimumRevision: number
  ): SqliteCatalogState {
    return this.mutations.replaceAll(sourceKey, records, metadata, minimumRevision);
  }

  upsert(record: SessionCatalogRecord, minimumRevision: number): SqliteCatalogState {
    return this.mutations.upsert(record, minimumRevision);
  }

  upsertMany(records: readonly SessionCatalogRecord[], minimumRevision: number): SqliteCatalogState {
    return this.mutations.upsertMany(records, minimumRevision);
  }

  setIncomplete(incomplete: boolean, skippedCount: number): SqliteCatalogState {
    return this.mutations.setIncomplete(incomplete, skippedCount);
  }

  organize(
    path: string,
    organization: SessionCatalogOrganization,
    minimumRevision: number
  ): SqliteCatalogState {
    return this.mutations.organize(path, organization, minimumRevision);
  }

  organizeMany(
    organizations: readonly { path: string; organization: SessionCatalogOrganization }[],
    minimumRevision: number
  ): SqliteCatalogState {
    return this.mutations.organizeMany(organizations, minimumRevision);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private assertDatabaseVersion(): void {
    const current = catalogDatabaseVersionFromRow(this.versionStatement.get());
    if (current.dataVersion !== this.openedVersion.dataVersion
      || current.schemaVersion !== this.openedVersion.schemaVersion) {
      throw new SessionCatalogChangedExternallyError();
    }
  }

  preserveAutomaticNames(sourceKey: string, records: SessionCatalogRecord[]): SessionCatalogRecord[] {
    return this.mutations.preserveAutomaticNames(sourceKey, records);
  }
}

function prepareCatalogForUse(database: DatabaseLike, create: boolean): CatalogDatabaseVersion {
  configureCatalogDatabase(database);
  database.exec("BEGIN IMMEDIATE");
  try {
    if (create) createCatalogSchema(database);
    else validateCatalogDatabase(database);
    const version = readCatalogDatabaseVersion(database);
    database.exec("COMMIT");
    return version;
  } catch (error) {
    rollback(database);
    throw error;
  }
}

function readCatalogDatabaseVersion(database: DatabaseLike): CatalogDatabaseVersion {
  return catalogDatabaseVersionFromRow(database.prepare(CATALOG_DATABASE_VERSION_SQL).get());
}

function catalogDatabaseVersionFromRow(row: Record<string, unknown> | undefined): CatalogDatabaseVersion {
  return {
    dataVersion: readInteger(row?.data_version, "data_version"),
    schemaVersion: readInteger(row?.schema_version, "schema_version")
  };
}

function classifySqliteFailure(error: unknown): "busy" | "replaceable" | "unavailable" {
  if (error instanceof SchemaMismatchError || error instanceof CorruptCatalogError) return "replaceable";
  const code = typeof error === "object" && error !== null && "errcode" in error
    ? Number((error as { errcode?: unknown }).errcode) & 0xff
    : undefined;
  if (code === 5 || code === 6) return "busy";
  if (code === 11 || code === 17 || code === 26) return "replaceable";
  return "unavailable";
}

function readInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SchemaMismatchError(`Catalog ${field} is invalid.`);
  }
  return value;
}

async function loadNodeSqlite(): Promise<DatabaseConstructor> {
  const { DatabaseSync } = await import("node:sqlite");
  return DatabaseSync;
}

function rollback(database: DatabaseLike): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Preserve the original transaction failure.
  }
}

function safeClose(database: DatabaseLike | undefined): void {
  try {
    database?.close();
  } catch {
    // Open failures are reported as a bounded fallback state.
  }
}
