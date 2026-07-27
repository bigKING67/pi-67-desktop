import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

interface DatabaseSyncLike {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): { get(): unknown };
}

interface DatabaseSyncConstructor {
  new(location: string): DatabaseSyncLike;
}

export interface NodeSqliteCapability {
  available: boolean;
  detail: string;
  storage: "memory" | "temporary-file";
}

type LoadDatabaseSync = () => Promise<DatabaseSyncConstructor>;

export async function probeNodeSqliteCapability(
  probeDirectory?: string,
  loadDatabaseSync: LoadDatabaseSync = loadNodeDatabaseSync
): Promise<NodeSqliteCapability> {
  const storage = probeDirectory === undefined ? "memory" : "temporary-file";
  let DatabaseSync: DatabaseSyncConstructor;
  try {
    DatabaseSync = await loadDatabaseSync();
  } catch {
    return {
      available: false,
      detail: "node:sqlite is unavailable in the Agent Host runtime.",
      storage
    };
  }

  let temporaryDirectory: string | undefined;
  let database: DatabaseSyncLike | undefined;
  try {
    const location = probeDirectory === undefined
      ? ":memory:"
      : await createTemporaryDatabaseLocation(probeDirectory).then((result) => {
          temporaryDirectory = result.directory;
          return result.location;
        });

    database = new DatabaseSync(location);
    database.exec("CREATE TABLE pi67_capability_probe (value INTEGER NOT NULL); INSERT INTO pi67_capability_probe VALUES (67);");
    const created = database.prepare("SELECT value FROM pi67_capability_probe LIMIT 1").get() as { value?: unknown } | undefined;
    if (created?.value !== 67) throw new Error("SQLite create verification failed.");
    database.close();
    database = undefined;

    database = new DatabaseSync(location);
    if (storage === "temporary-file") {
      const reopened = database.prepare("SELECT value FROM pi67_capability_probe LIMIT 1").get() as { value?: unknown } | undefined;
      if (reopened?.value !== 67) throw new Error("SQLite reopen verification failed.");
    }
    const version = database.prepare("SELECT sqlite_version() AS version").get() as { version?: unknown } | undefined;
    if (typeof version?.version !== "string" || version.version.length === 0) {
      throw new Error("SQLite version verification failed.");
    }
    database.close();
    database = undefined;

    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
    return {
      available: true,
      detail: `SQLite ${version.version}; ${storage} create/open/close/reopen verified.`,
      storage
    };
  } catch {
    safeClose(database);
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
    return {
      available: false,
      detail: "node:sqlite database lifecycle probe failed in the Agent Host runtime.",
      storage
    };
  }
}

async function loadNodeDatabaseSync(): Promise<DatabaseSyncConstructor> {
  const { DatabaseSync } = await import("node:sqlite");
  return DatabaseSync;
}

async function createTemporaryDatabaseLocation(
  probeDirectory: string
): Promise<{ directory: string; location: string }> {
  await mkdir(probeDirectory, { recursive: true });
  const directory = await mkdtemp(join(probeDirectory, ".pi67-sqlite-probe-"));
  return { directory, location: join(directory, "capability.sqlite") };
}

function safeClose(database: DatabaseSyncLike | undefined): void {
  try {
    database?.close();
  } catch {
    // The probe reports a generic failure and still attempts to remove its temporary directory.
  }
}
