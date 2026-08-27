import { randomUUID } from "node:crypto";
import { realpath } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  type ComposerDraftPersistedState,
  type ComposerDraftStateSnapshot
} from "@pi67/protocol";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";
import {
  emptyComposerDraftState,
  encodeStoredComposerDraftState,
  MAX_STORED_COMPOSER_DRAFT_STATE_BYTES,
  parseComposerDraftPersistedState,
  parseStoredComposerDraftState,
  type StoredComposerDraftState
} from "./composer-draft-state-parser.js";
import { WORKBENCH_STATE_DIRECTORY } from "./workbench-state-contract.js";

export { parseComposerDraftPersistedState } from "./composer-draft-state-parser.js";

const realpathNative = promisify(realpath.native);
const STATE_FILENAME = "composer-drafts-v1.json";
const BACKUP_FILENAME = "composer-drafts-v1.bak.json";
type StoredReadResult =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "state"; state: StoredComposerDraftState };

type DecodedState =
  | {
      kind: "state";
      persistence: "available" | "unavailable";
      state: ComposerDraftPersistedState;
    }
  | { kind: "decrypt-failed" }
  | { kind: "invalid" };

export interface ComposerDraftStateStoreOptions {
  encryption: DesktopTextEncryption;
  now?: () => number;
  createToken?: () => string;
}

export class ComposerDraftStateStore {
  readonly requestedStatePath: string;
  readonly requestedBackupPath: string;
  readonly #requestedUserData: string;
  readonly #encryption: DesktopTextEncryption;
  readonly #now: () => number;
  readonly #createToken: () => string;
  #memoryState: ComposerDraftPersistedState | undefined;
  #memoryPersistence: "available" | "unavailable" | undefined;
  #persistenceBlocked = false;
  #pending: Promise<void> = Promise.resolve();

  constructor(userData: string, options: ComposerDraftStateStoreOptions) {
    if (typeof userData !== "string" || userData.length === 0 || userData.includes("\0")) {
      throw new Error("Electron userData path is invalid.");
    }
    this.#requestedUserData = resolve(userData);
    this.requestedStatePath = join(this.#requestedUserData, WORKBENCH_STATE_DIRECTORY, STATE_FILENAME);
    this.requestedBackupPath = join(this.#requestedUserData, WORKBENCH_STATE_DIRECTORY, BACKUP_FILENAME);
    this.#encryption = options.encryption;
    this.#now = options.now ?? Date.now;
    this.#createToken = options.createToken ?? randomUUID;
  }

  load(): Promise<ComposerDraftStateSnapshot> {
    return this.#enqueue(() => this.#loadUnlocked());
  }

  update(value: unknown): Promise<ComposerDraftStateSnapshot> {
    return this.#enqueue(async () => {
      const state = parseComposerDraftPersistedState(value);
      if (!state) throw new Error("Composer draft state update is invalid.");
      const persistence = await this.#writeUnlocked(state);
      this.#memoryState = structuredClone(state);
      this.#memoryPersistence = persistence;
      return this.#snapshot(state, persistence);
    });
  }

  removeWorkspace(workspaceId: string): Promise<void> {
    return this.#enqueue(async () => {
      const loaded = await this.#loadUnlocked();
      const state = {
        version: 1 as const,
        drafts: loaded.state.drafts.filter((draft) => draft.conversation.workspaceId !== workspaceId),
        ...(loaded.state.selectedConversation?.workspaceId === workspaceId
          ? {}
          : loaded.state.selectedConversation
            ? { selectedConversation: loaded.state.selectedConversation }
            : {})
      };
      this.#memoryPersistence = await this.#writeUnlocked(state);
      this.#memoryState = state;
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation, operation);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async #loadUnlocked(): Promise<ComposerDraftStateSnapshot> {
    if (this.#memoryState) {
      if (!this.#memoryPersistence) {
        throw new Error("Composer draft persistence state is unavailable.");
      }
      return this.#snapshot(this.#memoryState, this.#memoryPersistence);
    }
    const directory = await this.#ensureStorageDirectory();
    const statePath = join(directory, STATE_FILENAME);
    const backupPath = join(directory, BACKUP_FILENAME);
    const primary = await this.#readStoredState(statePath);
    const decodedPrimary = primary.kind === "state" ? this.#decodeStoredState(primary.state) : undefined;
    if (decodedPrimary?.kind === "state") {
      this.#memoryState = decodedPrimary.state;
      this.#memoryPersistence = decodedPrimary.persistence;
      if (process.platform !== "win32") await chmod(statePath, 0o600);
      return this.#snapshot(decodedPrimary.state, decodedPrimary.persistence);
    }

    const backup = await this.#readStoredState(backupPath);
    const decodedBackup = backup.kind === "state" ? this.#decodeStoredState(backup.state) : undefined;
    if (decodedBackup?.kind === "state") {
      const persistence = await this.#writeUnlocked(decodedBackup.state);
      this.#memoryState = decodedBackup.state;
      this.#memoryPersistence = persistence;
      return { ...this.#snapshot(decodedBackup.state, persistence), recovery: "backup-restored" };
    }

    if (
      decodedPrimary?.kind === "decrypt-failed"
      || decodedBackup?.kind === "decrypt-failed"
    ) {
      this.#persistenceBlocked = true;
      const state = emptyComposerDraftState();
      this.#memoryState = state;
      this.#memoryPersistence = "unavailable";
      return { ...this.#snapshot(state, "unavailable"), recovery: "draft-decrypt-failed" };
    }

    if (primary.kind === "missing" && backup.kind === "missing") {
      const state = emptyComposerDraftState();
      this.#memoryState = state;
      this.#memoryPersistence = "available";
      return this.#snapshot(state, "available");
    }

    await this.#quarantine(statePath);
    await this.#quarantine(backupPath);
    const state = emptyComposerDraftState();
    this.#memoryState = state;
    this.#memoryPersistence = "available";
    return { ...this.#snapshot(state, "available"), recovery: "corrupt-reset" };
  }

  #snapshot(
    state: ComposerDraftPersistedState,
    persistence: "available" | "unavailable"
  ): ComposerDraftStateSnapshot {
    return {
      state: structuredClone(state),
      persistence
    };
  }

  async #readStoredState(path: string): Promise<StoredReadResult> {
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return { kind: "missing" };
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_STORED_COMPOSER_DRAFT_STATE_BYTES) {
      return { kind: "invalid" };
    }
    const handle = await open(path, "r");
    let serialized: string;
    try {
      serialized = await handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close();
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_COMPOSER_DRAFT_STATE_BYTES) return { kind: "invalid" };
    try {
      const value = JSON.parse(serialized) as unknown;
      const state = parseStoredComposerDraftState(value);
      return state ? { kind: "state", state } : { kind: "invalid" };
    } catch {
      return { kind: "invalid" };
    }
  }

  #decodeStoredState(stored: StoredComposerDraftState): DecodedState {
    if (stored.emptyState) {
      return { kind: "state", persistence: "available", state: emptyComposerDraftState() };
    }
    if (stored.encryptedState === undefined) {
      return {
        kind: "state",
        persistence: this.#encryption.isAvailable() ? "available" : "unavailable",
        state: emptyComposerDraftState()
      };
    }
    if (!this.#encryption.isAvailable()) return { kind: "decrypt-failed" };
    try {
      const decrypted = this.#encryption.decrypt(Buffer.from(stored.encryptedState, "base64"));
      const parsed = parseComposerDraftPersistedState(JSON.parse(decrypted) as unknown);
      return parsed
        ? { kind: "state", persistence: "available", state: parsed }
        : { kind: "invalid" };
    } catch {
      return { kind: "decrypt-failed" };
    }
  }

  async #writeUnlocked(
    state: ComposerDraftPersistedState
  ): Promise<"available" | "unavailable"> {
    if (state.drafts.length === 0 && this.#persistenceBlocked && !this.#encryption.isAvailable()) {
      return "unavailable";
    }
    if (state.drafts.length > 0 && !this.#encryption.isAvailable()) {
      this.#persistenceBlocked = true;
      return "unavailable";
    }
    let stored: StoredComposerDraftState;
    try {
      stored = encodeStoredComposerDraftState(state, this.#encryption);
    } catch {
      this.#persistenceBlocked = true;
      return "unavailable";
    }
    if (state.drafts.length > 0 && stored.encryptedState === undefined) {
      this.#persistenceBlocked = true;
      return "unavailable";
    }
    const serialized = `${JSON.stringify(stored)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_COMPOSER_DRAFT_STATE_BYTES) {
      throw new Error("Composer draft state exceeds the persistence size limit.");
    }
    const directory = await this.#ensureStorageDirectory();
    await this.#writeAtomic(join(directory, BACKUP_FILENAME), serialized);
    await this.#writeAtomic(join(directory, STATE_FILENAME), serialized);
    this.#persistenceBlocked = false;
    return "available";
  }

  async #writeAtomic(path: string, serialized: string): Promise<void> {
    const temporaryPath = join(
      dirname(path),
      `.${basename(path)}.${process.pid}.${this.#createToken()}.tmp`
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
      await rename(temporaryPath, path);
      temporaryExists = false;
      if (process.platform !== "win32") await chmod(path, 0o600);
    } finally {
      if (temporaryExists) await unlink(temporaryPath).catch(() => undefined);
    }
  }

  async #quarantine(path: string): Promise<void> {
    const quarantinePath = join(
      dirname(path),
      `${basename(path, ".json")}.corrupt-${this.#now()}-${this.#createToken()}.json`
    );
    await rename(path, quarantinePath).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) throw error;
    });
  }

  async #ensureStorageDirectory(): Promise<string> {
    await mkdir(this.#requestedUserData, { recursive: true, mode: 0o700 });
    const canonicalUserData = await realpathNative(this.#requestedUserData);
    const requestedDirectory = join(canonicalUserData, WORKBENCH_STATE_DIRECTORY);
    try {
      const metadata = await lstat(requestedDirectory);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error("Composer draft storage path must be a real directory.");
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
  if (fromRoot !== "" && (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))) {
    throw new Error("Composer draft storage escaped the Electron userData directory.");
  }
}

function normalizePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
