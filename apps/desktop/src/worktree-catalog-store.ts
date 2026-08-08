import { randomUUID } from "node:crypto";
import { realpath } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  isRepositoryEnvironmentSnapshot,
  type RepositoryEnvironmentSnapshot
} from "@pi67/protocol";
import { WORKBENCH_STATE_DIRECTORY } from "./workbench-state-contract.js";

const realpathNative = promisify(realpath.native);
const CATALOG_FILENAME = "worktree-catalog-v1.json";
const CATALOG_VERSION = 1;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_CATALOG_RECORDS = 100;

interface WorktreeCatalogRecord {
  workspaceId: string;
  workspaceFingerprint: string;
  snapshot: RepositoryEnvironmentSnapshot;
}

interface WorktreeCatalogState {
  version: 1;
  observations: WorktreeCatalogRecord[];
}

export interface WorktreeCatalogStoreOptions {
  now?: () => number;
  createToken?: () => string;
}

export class WorktreeCatalogStore {
  readonly requestedCatalogPath: string;
  readonly #requestedUserData: string;
  readonly #now: () => number;
  readonly #createToken: () => string;
  #pending: Promise<void> = Promise.resolve();

  constructor(userData: string, options: WorktreeCatalogStoreOptions = {}) {
    if (typeof userData !== "string" || userData.length === 0 || userData.includes("\0")) {
      throw new Error("Electron userData path is invalid.");
    }
    this.#requestedUserData = resolve(userData);
    this.requestedCatalogPath = join(this.#requestedUserData, WORKBENCH_STATE_DIRECTORY, CATALOG_FILENAME);
    this.#now = options.now ?? Date.now;
    this.#createToken = options.createToken ?? randomUUID;
  }

  load(workspaceId: string, workspaceFingerprint: string): Promise<RepositoryEnvironmentSnapshot | undefined> {
    return this.#enqueue(async () => {
      const state = await this.#loadUnlocked();
      const record = state.observations.find((candidate) => (
        candidate.workspaceId === workspaceId
        && candidate.workspaceFingerprint === workspaceFingerprint
      ));
      return record ? structuredClone(record.snapshot) : undefined;
    });
  }

  replace(workspaceFingerprint: string, snapshot: RepositoryEnvironmentSnapshot): Promise<void> {
    if (!isFingerprint(workspaceFingerprint) || !isRepositoryEnvironmentSnapshot(snapshot)) {
      return Promise.reject(new Error("Worktree Catalog observation is invalid."));
    }
    return this.#enqueue(async () => {
      const state = await this.#loadUnlocked();
      const observations = state.observations.filter((record) => record.workspaceId !== snapshot.workspaceId);
      observations.push({
        workspaceId: snapshot.workspaceId,
        workspaceFingerprint,
        snapshot: structuredClone(snapshot)
      });
      if (observations.length > MAX_CATALOG_RECORDS) {
        throw new Error("Worktree Catalog record limit exceeded.");
      }
      await this.#writeUnlocked({ version: CATALOG_VERSION, observations });
    });
  }

  removeWorkspace(workspaceId: string): Promise<void> {
    return this.#enqueue(async () => {
      const state = await this.#loadUnlocked();
      const observations = state.observations.filter((record) => record.workspaceId !== workspaceId);
      if (observations.length === state.observations.length) return;
      await this.#writeUnlocked({ version: CATALOG_VERSION, observations });
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation, operation);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async #loadUnlocked(): Promise<WorktreeCatalogState> {
    const directory = await this.#ensureStorageDirectory();
    const catalogPath = join(directory, CATALOG_FILENAME);
    let metadata;
    try {
      metadata = await lstat(catalogPath);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return emptyCatalog();
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_CATALOG_BYTES) {
      return this.#quarantineCorruptCatalog(catalogPath);
    }
    let serialized: string | undefined;
    try {
      const handle = await open(catalogPath, "r");
      try {
        const current = await handle.stat();
        if (current.size <= MAX_CATALOG_BYTES) {
          serialized = await handle.readFile({ encoding: "utf8" });
        }
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return emptyCatalog();
      throw error;
    }
    if (serialized === undefined) return this.#quarantineCorruptCatalog(catalogPath);
    const state = parseCatalog(serialized);
    if (!state) return this.#quarantineCorruptCatalog(catalogPath);
    if (process.platform !== "win32") await chmod(catalogPath, 0o600);
    return state;
  }

  async #writeUnlocked(state: WorktreeCatalogState): Promise<void> {
    const serialized = `${JSON.stringify(state)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_CATALOG_BYTES) {
      throw new Error("Worktree Catalog exceeds the persistence size limit.");
    }
    const directory = await this.#ensureStorageDirectory();
    const catalogPath = join(directory, CATALOG_FILENAME);
    const temporaryPath = join(
      directory,
      `.${CATALOG_FILENAME}.${process.pid}.${this.#createToken()}.tmp`
    );
    let temporaryExists = false;
    try {
      const handle = await open(temporaryPath, "wx", 0o600);
      temporaryExists = true;
      try {
        await handle.writeFile(serialized, { encoding: "utf8" });
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, catalogPath);
      temporaryExists = false;
      if (process.platform !== "win32") await chmod(catalogPath, 0o600);
      await syncDirectory(directory);
    } finally {
      if (temporaryExists) await unlink(temporaryPath).catch(() => undefined);
    }
  }

  async #quarantineCorruptCatalog(catalogPath: string): Promise<WorktreeCatalogState> {
    const quarantinePath = join(
      dirname(catalogPath),
      `${basename(catalogPath, ".json")}.corrupt-${this.#now()}-${this.#createToken()}.json`
    );
    await rename(catalogPath, quarantinePath).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) throw error;
    });
    return emptyCatalog();
  }

  async #ensureStorageDirectory(): Promise<string> {
    await mkdir(this.#requestedUserData, { recursive: true, mode: 0o700 });
    const canonicalUserData = await realpathNative(this.#requestedUserData);
    const requestedDirectory = join(canonicalUserData, WORKBENCH_STATE_DIRECTORY);
    try {
      const metadata = await lstat(requestedDirectory);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error("Worktree Catalog storage path must be a real directory.");
      }
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
      await mkdir(requestedDirectory, { mode: 0o700 });
    }
    const canonicalDirectory = await realpathNative(requestedDirectory);
    assertContained(canonicalUserData, canonicalDirectory);
    if (process.platform !== "win32") await chmod(canonicalDirectory, 0o700);
    return canonicalDirectory;
  }
}

function parseCatalog(serialized: string): WorktreeCatalogState | undefined {
  if (Buffer.byteLength(serialized, "utf8") > MAX_CATALOG_BYTES) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecordWithExactKeys(value, ["version", "observations"]) || value.version !== CATALOG_VERSION) {
    return undefined;
  }
  if (!Array.isArray(value.observations) || value.observations.length > MAX_CATALOG_RECORDS) return undefined;
  const observations: WorktreeCatalogRecord[] = [];
  const workspaceIds = new Set<string>();
  for (const candidate of value.observations) {
    if (!isRecordWithExactKeys(candidate, ["workspaceId", "workspaceFingerprint", "snapshot"])) return undefined;
    if (
      typeof candidate.workspaceId !== "string"
      || workspaceIds.has(candidate.workspaceId)
      || !isFingerprint(candidate.workspaceFingerprint)
      || !isRepositoryEnvironmentSnapshot(candidate.snapshot)
      || candidate.snapshot.workspaceId !== candidate.workspaceId
    ) return undefined;
    workspaceIds.add(candidate.workspaceId);
    observations.push({
      workspaceId: candidate.workspaceId,
      workspaceFingerprint: candidate.workspaceFingerprint,
      snapshot: structuredClone(candidate.snapshot)
    });
  }
  return { version: CATALOG_VERSION, observations };
}

function emptyCatalog(): WorktreeCatalogState {
  return { version: CATALOG_VERSION, observations: [] };
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r").catch(() => undefined);
  if (!handle) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close();
  }
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function isRecordWithExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function assertContained(root: string, candidate: string): void {
  const fromRoot = relative(normalizePath(root), normalizePath(candidate));
  if (fromRoot !== "" && (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))) {
    throw new Error("Worktree Catalog storage escaped the Electron userData directory.");
  }
}

function normalizePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
