import { randomUUID } from "node:crypto";
import { realpath } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { WorkspaceFilePersistedState, WorkspaceFileStateSnapshot } from "@pi67/protocol";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";
import { WORKBENCH_STATE_DIRECTORY } from "./workbench-state-contract.js";
import {
  decodeStoredState,
  emptyWorkspaceFileState,
  encodeStoredState,
  hasWorkspaceFileDrafts,
  parseStoredState,
  parseWorkspaceFilePersistedState,
  type StoredWorkspaceFileState
} from "./workspace-file-state-codec.js";

const realpathNative = promisify(realpath.native);
const STATE_FILENAME = "workspace-files-v1.json";
const MAX_STORED_STATE_BYTES = 32 * 1024 * 1024;

export type WorkspaceFileEncryption = DesktopTextEncryption;

export interface WorkspaceFileStateStoreOptions {
  encryption: WorkspaceFileEncryption;
  now?: () => number;
  createToken?: () => string;
}

export class WorkspaceFileStateStore {
  readonly requestedStatePath: string;
  readonly #requestedUserData: string;
  readonly #encryption: WorkspaceFileEncryption;
  readonly #now: () => number;
  readonly #createToken: () => string;
  #memoryState: WorkspaceFilePersistedState | undefined;
  #memoryDraftPersistence: "available" | "unavailable" | undefined;
  #draftPersistenceBlocked = false;
  #pending: Promise<void> = Promise.resolve();

  constructor(userData: string, options: WorkspaceFileStateStoreOptions) {
    if (typeof userData !== "string" || userData.length === 0 || userData.includes("\0")) {
      throw new Error("Electron userData path is invalid.");
    }
    this.#requestedUserData = resolve(userData);
    this.requestedStatePath = join(this.#requestedUserData, WORKBENCH_STATE_DIRECTORY, STATE_FILENAME);
    this.#encryption = options.encryption;
    this.#now = options.now ?? Date.now;
    this.#createToken = options.createToken ?? randomUUID;
  }

  load(): Promise<WorkspaceFileStateSnapshot> {
    return this.#enqueue(() => this.#loadUnlocked());
  }

  update(value: unknown): Promise<WorkspaceFileStateSnapshot> {
    return this.#enqueue(async () => {
      const state = parseWorkspaceFilePersistedState(value);
      if (!state) throw new Error("Workspace file state update is invalid.");
      const draftPersistence = await this.#writeUnlocked(state);
      this.#memoryState = structuredClone(state);
      this.#memoryDraftPersistence = draftPersistence;
      return this.#snapshot(state, draftPersistence);
    });
  }

  removeWorkspace(workspaceId: string): Promise<void> {
    return this.#enqueue(async () => {
      const loaded = await this.#loadUnlocked();
      const state = {
        ...loaded.state,
        workspaces: loaded.state.workspaces.filter((workspace) => workspace.workspaceId !== workspaceId)
      };
      const draftPersistence = await this.#writeUnlocked(state);
      this.#memoryState = state;
      this.#memoryDraftPersistence = draftPersistence;
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation, operation);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async #loadUnlocked(): Promise<WorkspaceFileStateSnapshot> {
    if (this.#memoryState) {
      if (!this.#memoryDraftPersistence) throw new Error("Workspace file persistence state is unavailable.");
      return this.#snapshot(this.#memoryState, this.#memoryDraftPersistence);
    }
    const directory = await this.#ensureStorageDirectory();
    const statePath = join(directory, STATE_FILENAME);
    const stored = await this.#readStoredState(statePath);
    if (stored.kind === "missing") {
      const state = emptyWorkspaceFileState();
      this.#memoryState = state;
      this.#memoryDraftPersistence = "available";
      return this.#snapshot(state, "available");
    }
    if (stored.kind === "invalid") return this.#quarantineCorruptState(statePath);
    const decoded = decodeStoredState(stored.state, this.#encryption);
    this.#draftPersistenceBlocked = decoded.decryptFailed;
    this.#memoryState = decoded.state;
    this.#memoryDraftPersistence = decoded.decryptFailed ? "unavailable" : "available";
    if (process.platform !== "win32") await chmod(statePath, 0o600);
    return {
      ...this.#snapshot(decoded.state, this.#memoryDraftPersistence),
      ...(decoded.decryptFailed ? { recovery: "draft-decrypt-failed" as const } : {})
    };
  }

  #snapshot(
    state: WorkspaceFilePersistedState,
    draftPersistence: "available" | "unavailable"
  ): WorkspaceFileStateSnapshot {
    return {
      state: structuredClone(state),
      draftPersistence
    };
  }

  async #readStoredState(path: string): Promise<
    | { kind: "missing" }
    | { kind: "invalid" }
    | { kind: "state"; state: StoredWorkspaceFileState }
  > {
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return { kind: "missing" };
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_STORED_STATE_BYTES) {
      return { kind: "invalid" };
    }
    const handle = await open(path, "r");
    let serialized: string;
    try {
      serialized = await handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close();
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_STATE_BYTES) return { kind: "invalid" };
    try {
      const value = JSON.parse(serialized) as unknown;
      const state = parseStoredState(value);
      return state ? { kind: "state", state } : { kind: "invalid" };
    } catch {
      return { kind: "invalid" };
    }
  }

  async #writeUnlocked(
    state: WorkspaceFilePersistedState
  ): Promise<"available" | "unavailable"> {
    const hasDrafts = hasWorkspaceFileDrafts(state);
    if ((this.#draftPersistenceBlocked || hasDrafts) && !this.#encryption.isAvailable()) {
      this.#draftPersistenceBlocked = true;
      return "unavailable";
    }
    let stored: StoredWorkspaceFileState;
    try {
      stored = encodeStoredState(state, this.#encryption);
    } catch {
      this.#draftPersistenceBlocked = true;
      return "unavailable";
    }
    const serialized = `${JSON.stringify(stored)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_STATE_BYTES) {
      throw new Error("Workspace file state exceeds the persistence size limit.");
    }
    const directory = await this.#ensureStorageDirectory();
    const statePath = join(directory, STATE_FILENAME);
    const temporaryPath = join(directory, `.${STATE_FILENAME}.${process.pid}.${this.#createToken()}.tmp`);
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
      await rename(temporaryPath, statePath);
      temporaryExists = false;
      if (process.platform !== "win32") await chmod(statePath, 0o600);
    } finally {
      if (temporaryExists) await unlink(temporaryPath).catch(() => undefined);
    }
    this.#draftPersistenceBlocked = false;
    return "available";
  }

  async #quarantineCorruptState(statePath: string): Promise<WorkspaceFileStateSnapshot> {
    const quarantinePath = join(
      dirname(statePath),
      `${basename(statePath, ".json")}.corrupt-${this.#now()}-${this.#createToken()}.json`
    );
    await rename(statePath, quarantinePath).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) throw error;
    });
    const state = emptyWorkspaceFileState();
    this.#memoryState = state;
    this.#memoryDraftPersistence = "available";
    return { ...this.#snapshot(state, "available"), recovery: "corrupt-reset" };
  }

  async #ensureStorageDirectory(): Promise<string> {
    await mkdir(this.#requestedUserData, { recursive: true, mode: 0o700 });
    const canonicalUserData = await realpathNative(this.#requestedUserData);
    const requestedDirectory = join(canonicalUserData, WORKBENCH_STATE_DIRECTORY);
    try {
      const metadata = await lstat(requestedDirectory);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error("Workspace file storage path must be a real directory.");
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

function assertContained(root: string, candidate: string): void {
  const fromRoot = relative(normalizePath(root), normalizePath(candidate));
  if (fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))) return;
  throw new Error("Workspace file storage escaped Electron userData.");
}

function normalizePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
