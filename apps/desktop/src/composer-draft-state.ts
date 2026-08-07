import { randomUUID } from "node:crypto";
import { realpath } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  MAX_COMPOSER_DRAFTS,
  MAX_COMPOSER_DRAFT_TEXT_BYTES,
  MAX_COMPOSER_DRAFT_TEXT_BYTES_TOTAL,
  type ComposerDraftPersistedState,
  type ComposerDraftRecord,
  type ComposerDraftStateSnapshot
} from "@pi67/protocol";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";
import { WORKBENCH_STATE_DIRECTORY } from "./workbench-state-contract.js";

const realpathNative = promisify(realpath.native);
const STATE_FILENAME = "composer-drafts-v1.json";
const BACKUP_FILENAME = "composer-drafts-v1.bak.json";
const MAX_STORED_STATE_BYTES = 8 * 1024 * 1024;
const MAX_ID_CHARS = 1_024;
const MAX_DRAFT_ID_CHARS = 200;
const MAX_SESSION_FILE_IDENTITY_CHARS = 32_832;
const MAX_SESSION_PATH_CHARS = 32_768;

interface StoredComposerDraftState {
  version: 1;
  encryptedState?: string;
}

type StoredReadResult =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "state"; state: StoredComposerDraftState };

type DecodedState =
  | { kind: "state"; state: ComposerDraftPersistedState }
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
      await this.#writeUnlocked(state);
      this.#memoryState = structuredClone(state);
      return this.#snapshot(state);
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
      await this.#writeUnlocked(state);
      this.#memoryState = state;
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation, operation);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async #loadUnlocked(): Promise<ComposerDraftStateSnapshot> {
    if (this.#memoryState) return this.#snapshot(this.#memoryState);
    const directory = await this.#ensureStorageDirectory();
    const statePath = join(directory, STATE_FILENAME);
    const backupPath = join(directory, BACKUP_FILENAME);
    const primary = await this.#readStoredState(statePath);
    const decodedPrimary = primary.kind === "state" ? this.#decodeStoredState(primary.state) : undefined;
    if (decodedPrimary?.kind === "state") {
      this.#memoryState = decodedPrimary.state;
      if (process.platform !== "win32") await chmod(statePath, 0o600);
      return this.#snapshot(decodedPrimary.state);
    }

    const backup = await this.#readStoredState(backupPath);
    const decodedBackup = backup.kind === "state" ? this.#decodeStoredState(backup.state) : undefined;
    if (decodedBackup?.kind === "state") {
      await this.#writeUnlocked(decodedBackup.state);
      this.#memoryState = decodedBackup.state;
      return { ...this.#snapshot(decodedBackup.state), recovery: "backup-restored" };
    }

    if (
      decodedPrimary?.kind === "decrypt-failed"
      || decodedBackup?.kind === "decrypt-failed"
    ) {
      const state = emptyState();
      this.#memoryState = state;
      return { ...this.#snapshot(state), recovery: "draft-decrypt-failed" };
    }

    if (primary.kind === "missing" && backup.kind === "missing") {
      const state = emptyState();
      this.#memoryState = state;
      return this.#snapshot(state);
    }

    await this.#quarantine(statePath);
    await this.#quarantine(backupPath);
    const state = emptyState();
    this.#memoryState = state;
    return { ...this.#snapshot(state), recovery: "corrupt-reset" };
  }

  #snapshot(state: ComposerDraftPersistedState): ComposerDraftStateSnapshot {
    return {
      state: structuredClone(state),
      persistence: this.#encryption.isAvailable() ? "available" : "unavailable"
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

  #decodeStoredState(stored: StoredComposerDraftState): DecodedState {
    if (stored.encryptedState === undefined) return { kind: "state", state: emptyState() };
    if (!this.#encryption.isAvailable()) return { kind: "decrypt-failed" };
    try {
      const decrypted = this.#encryption.decrypt(Buffer.from(stored.encryptedState, "base64"));
      const parsed = parseComposerDraftPersistedState(JSON.parse(decrypted) as unknown);
      return parsed ? { kind: "state", state: parsed } : { kind: "invalid" };
    } catch {
      return { kind: "decrypt-failed" };
    }
  }

  async #writeUnlocked(state: ComposerDraftPersistedState): Promise<void> {
    const stored = encodeStoredState(state, this.#encryption);
    const serialized = `${JSON.stringify(stored)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_STATE_BYTES) {
      throw new Error("Composer draft state exceeds the persistence size limit.");
    }
    const directory = await this.#ensureStorageDirectory();
    await this.#writeAtomic(join(directory, BACKUP_FILENAME), serialized);
    await this.#writeAtomic(join(directory, STATE_FILENAME), serialized);
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

export function parseComposerDraftPersistedState(value: unknown): ComposerDraftPersistedState | undefined {
  if (!isRecordWithAllowedKeys(value, ["version", "drafts", "selectedConversation"], ["version", "drafts"])) {
    return undefined;
  }
  if (value.version !== 1 || !Array.isArray(value.drafts) || value.drafts.length > MAX_COMPOSER_DRAFTS) {
    return undefined;
  }
  const drafts: ComposerDraftRecord[] = [];
  const identities = new Set<string>();
  let totalTextBytes = 0;
  for (const candidate of value.drafts) {
    if (!isRecordWithAllowedKeys(
      candidate,
      ["conversation", "text", "streamBehavior", "updatedAt"],
      ["conversation", "text", "streamBehavior", "updatedAt"]
    )) return undefined;
    const conversation = parseConversation(candidate.conversation);
    if (!conversation || typeof candidate.text !== "string" || candidate.text.length === 0) return undefined;
    const textBytes = Buffer.byteLength(candidate.text, "utf8");
    totalTextBytes += textBytes;
    if (
      textBytes > MAX_COMPOSER_DRAFT_TEXT_BYTES
      || totalTextBytes > MAX_COMPOSER_DRAFT_TEXT_BYTES_TOTAL
      || (candidate.streamBehavior !== "steer" && candidate.streamBehavior !== "followUp")
      || !Number.isSafeInteger(candidate.updatedAt)
      || Number(candidate.updatedAt) < 0
    ) return undefined;
    const identity = conversationIdentity(conversation);
    if (identities.has(identity)) return undefined;
    identities.add(identity);
    drafts.push({
      conversation,
      text: candidate.text,
      streamBehavior: candidate.streamBehavior,
      updatedAt: Number(candidate.updatedAt)
    });
  }
  const selectedConversation = value.selectedConversation === undefined
    ? undefined
    : parseConversation(value.selectedConversation);
  if (value.selectedConversation !== undefined && !selectedConversation) return undefined;
  if (selectedConversation && !identities.has(conversationIdentity(selectedConversation))) return undefined;
  return {
    version: 1,
    drafts,
    ...(selectedConversation ? { selectedConversation } : {})
  };
}

function parseStoredState(value: unknown): StoredComposerDraftState | undefined {
  if (!isRecordWithAllowedKeys(value, ["version", "encryptedState"], ["version"]) || value.version !== 1) {
    return undefined;
  }
  if (value.encryptedState === undefined) return { version: 1 };
  if (
    typeof value.encryptedState !== "string"
    || value.encryptedState.length === 0
    || value.encryptedState.length > MAX_STORED_STATE_BYTES
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.encryptedState)
  ) return undefined;
  return { version: 1, encryptedState: value.encryptedState };
}

function encodeStoredState(
  state: ComposerDraftPersistedState,
  encryption: DesktopTextEncryption
): StoredComposerDraftState {
  if (!encryption.isAvailable()) return { version: 1 };
  return {
    version: 1,
    encryptedState: encryption.encrypt(JSON.stringify(state)).toString("base64")
  };
}

function parseConversation(value: unknown): ComposerDraftRecord["conversation"] | undefined {
  if (!isRecord(value) || !isBoundedString(value.workspaceId, MAX_ID_CHARS)) return undefined;
  if (
    value.kind === "provisional"
    && hasExactKeys(value, ["kind", "workspaceId", "draftId"])
    && isBoundedString(value.draftId, MAX_DRAFT_ID_CHARS)
  ) {
    return { kind: "provisional", workspaceId: value.workspaceId, draftId: value.draftId };
  }
  if (
    value.kind === "session"
    && hasExactKeys(value, ["kind", "workspaceId", "sessionFileIdentity", "sessionPath"])
    && isBoundedString(value.sessionFileIdentity, MAX_SESSION_FILE_IDENTITY_CHARS)
    && typeof value.sessionPath === "string"
    && value.sessionPath.length > 0
    && value.sessionPath.length <= MAX_SESSION_PATH_CHARS
    && !value.sessionPath.includes("\0")
    && isAbsolute(value.sessionPath)
  ) {
    return {
      kind: "session",
      workspaceId: value.workspaceId,
      sessionFileIdentity: value.sessionFileIdentity,
      sessionPath: value.sessionPath
    };
  }
  return undefined;
}

function conversationIdentity(conversation: ComposerDraftRecord["conversation"]): string {
  return conversation.kind === "session"
    ? `session:${conversation.workspaceId}:${conversation.sessionFileIdentity}`
    : `provisional:${conversation.workspaceId}:${conversation.draftId}`;
}

function emptyState(): ComposerDraftPersistedState {
  return { version: 1, drafts: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordWithAllowedKeys(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0");
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
