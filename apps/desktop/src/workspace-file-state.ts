import { randomUUID } from "node:crypto";
import { realpath } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  MAX_WORKSPACE_FILE_DRAFT_BYTES_TOTAL,
  MAX_WORKSPACE_FILE_PATH_CHARS,
  MAX_WORKSPACE_FILE_TABS_PER_WORKSPACE,
  MAX_WORKSPACE_FILE_TABS_TOTAL,
  type WorkspaceFilePersistedState,
  type WorkspaceFilePersistedTab,
  type WorkspaceFileStateSnapshot
} from "@pi67/protocol";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";
import { WORKBENCH_STATE_DIRECTORY } from "./workbench-state-contract.js";

const realpathNative = promisify(realpath.native);
const STATE_FILENAME = "workspace-files-v1.json";
const MAX_STORED_STATE_BYTES = 32 * 1024 * 1024;
const MAX_WORKSPACES = 100;

interface StoredWorkspaceFileTab {
  relativePath: string;
  baseRevision?: string;
  encryptedDraft?: string;
}

interface StoredWorkspaceFileState {
  version: 1;
  workspaces: Array<{
    workspaceId: string;
    tabs: StoredWorkspaceFileTab[];
    activeRelativePath?: string;
  }>;
}

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
      this.#memoryState = structuredClone(state);
      await this.#writeUnlocked(state);
      return this.#snapshot(state);
    });
  }

  removeWorkspace(workspaceId: string): Promise<void> {
    return this.#enqueue(async () => {
      const loaded = await this.#loadUnlocked();
      const state = {
        ...loaded.state,
        workspaces: loaded.state.workspaces.filter((workspace) => workspace.workspaceId !== workspaceId)
      };
      this.#memoryState = state;
      await this.#writeUnlocked(state);
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation, operation);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async #loadUnlocked(): Promise<WorkspaceFileStateSnapshot> {
    if (this.#memoryState) return this.#snapshot(this.#memoryState);
    const directory = await this.#ensureStorageDirectory();
    const statePath = join(directory, STATE_FILENAME);
    const stored = await this.#readStoredState(statePath);
    if (stored.kind === "missing") {
      const state = emptyState();
      this.#memoryState = state;
      return this.#snapshot(state);
    }
    if (stored.kind === "invalid") return this.#quarantineCorruptState(statePath);
    const decoded = decodeStoredState(stored.state, this.#encryption);
    this.#memoryState = decoded.state;
    if (process.platform !== "win32") await chmod(statePath, 0o600);
    return {
      ...this.#snapshot(decoded.state),
      ...(decoded.decryptFailed ? { recovery: "draft-decrypt-failed" as const } : {})
    };
  }

  #snapshot(state: WorkspaceFilePersistedState): WorkspaceFileStateSnapshot {
    return {
      state: structuredClone(state),
      draftPersistence: this.#encryption.isAvailable() ? "available" : "unavailable"
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

  async #writeUnlocked(state: WorkspaceFilePersistedState): Promise<void> {
    const stored = encodeStoredState(state, this.#encryption);
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
  }

  async #quarantineCorruptState(statePath: string): Promise<WorkspaceFileStateSnapshot> {
    const quarantinePath = join(
      dirname(statePath),
      `${basename(statePath, ".json")}.corrupt-${this.#now()}-${this.#createToken()}.json`
    );
    await rename(statePath, quarantinePath).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) throw error;
    });
    const state = emptyState();
    this.#memoryState = state;
    return { ...this.#snapshot(state), recovery: "corrupt-reset" };
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

function parseWorkspaceFilePersistedState(value: unknown): WorkspaceFilePersistedState | undefined {
  if (!isExactRecord(value, ["version", "workspaces"]) || value.version !== 1 || !Array.isArray(value.workspaces)) {
    return undefined;
  }
  if (value.workspaces.length > MAX_WORKSPACES) return undefined;
  const workspaces: WorkspaceFilePersistedState["workspaces"] = [];
  const workspaceIds = new Set<string>();
  let totalTabs = 0;
  let totalDraftBytes = 0;
  for (const workspaceValue of value.workspaces) {
    if (!isRecordWithAllowedKeys(
      workspaceValue,
      ["workspaceId", "tabs", "activeRelativePath"],
      ["workspaceId", "tabs"]
    )) return undefined;
    if (!isWorkspaceId(workspaceValue.workspaceId) || workspaceIds.has(workspaceValue.workspaceId)) return undefined;
    if (!Array.isArray(workspaceValue.tabs) || workspaceValue.tabs.length > MAX_WORKSPACE_FILE_TABS_PER_WORKSPACE) {
      return undefined;
    }
    const paths = new Set<string>();
    const tabs: WorkspaceFilePersistedTab[] = [];
    for (const tabValue of workspaceValue.tabs) {
      if (!isRecordWithAllowedKeys(
        tabValue,
        ["relativePath", "baseRevision", "draft"],
        ["relativePath"]
      )) return undefined;
      if (!isRelativePath(tabValue.relativePath) || paths.has(tabValue.relativePath)) return undefined;
      if (tabValue.baseRevision !== undefined && !isOpaqueRevision(tabValue.baseRevision)) return undefined;
      if (tabValue.draft !== undefined) {
        if (typeof tabValue.draft !== "string" || tabValue.baseRevision === undefined) return undefined;
        totalDraftBytes += Buffer.byteLength(tabValue.draft, "utf8");
      }
      paths.add(tabValue.relativePath);
      tabs.push({
        relativePath: tabValue.relativePath,
        ...(tabValue.baseRevision === undefined ? {} : { baseRevision: tabValue.baseRevision }),
        ...(tabValue.draft === undefined ? {} : { draft: tabValue.draft })
      });
    }
    totalTabs += tabs.length;
    if (totalTabs > MAX_WORKSPACE_FILE_TABS_TOTAL || totalDraftBytes > MAX_WORKSPACE_FILE_DRAFT_BYTES_TOTAL) {
      return undefined;
    }
    if (
      workspaceValue.activeRelativePath !== undefined
      && (!isRelativePath(workspaceValue.activeRelativePath) || !paths.has(workspaceValue.activeRelativePath))
    ) return undefined;
    workspaceIds.add(workspaceValue.workspaceId);
    workspaces.push({
      workspaceId: workspaceValue.workspaceId,
      tabs,
      ...(workspaceValue.activeRelativePath === undefined
        ? {}
        : { activeRelativePath: workspaceValue.activeRelativePath })
    });
  }
  return { version: 1, workspaces };
}

function parseStoredState(value: unknown): StoredWorkspaceFileState | undefined {
  if (!isExactRecord(value, ["version", "workspaces"]) || value.version !== 1 || !Array.isArray(value.workspaces)) {
    return undefined;
  }
  if (value.workspaces.length > MAX_WORKSPACES) return undefined;
  const workspaces: StoredWorkspaceFileState["workspaces"] = [];
  let totalTabs = 0;
  for (const workspaceValue of value.workspaces) {
    if (!isRecordWithAllowedKeys(
      workspaceValue,
      ["workspaceId", "tabs", "activeRelativePath"],
      ["workspaceId", "tabs"]
    ) || !isWorkspaceId(workspaceValue.workspaceId) || !Array.isArray(workspaceValue.tabs)) return undefined;
    if (workspaceValue.tabs.length > MAX_WORKSPACE_FILE_TABS_PER_WORKSPACE) return undefined;
    const tabs: StoredWorkspaceFileTab[] = [];
    const paths = new Set<string>();
    for (const tabValue of workspaceValue.tabs) {
      if (!isRecordWithAllowedKeys(
        tabValue,
        ["relativePath", "baseRevision", "encryptedDraft"],
        ["relativePath"]
      ) || !isRelativePath(tabValue.relativePath) || paths.has(tabValue.relativePath)) return undefined;
      if (tabValue.baseRevision !== undefined && !isOpaqueRevision(tabValue.baseRevision)) return undefined;
      if (
        tabValue.encryptedDraft !== undefined
        && (typeof tabValue.encryptedDraft !== "string" || tabValue.baseRevision === undefined)
      ) return undefined;
      paths.add(tabValue.relativePath);
      tabs.push(tabValue as unknown as StoredWorkspaceFileTab);
    }
    totalTabs += tabs.length;
    if (totalTabs > MAX_WORKSPACE_FILE_TABS_TOTAL) return undefined;
    if (
      workspaceValue.activeRelativePath !== undefined
      && (typeof workspaceValue.activeRelativePath !== "string" || !paths.has(workspaceValue.activeRelativePath))
    ) return undefined;
    workspaces.push({
      workspaceId: workspaceValue.workspaceId,
      tabs,
      ...(workspaceValue.activeRelativePath === undefined
        ? {}
        : { activeRelativePath: workspaceValue.activeRelativePath })
    });
  }
  return { version: 1, workspaces };
}

function encodeStoredState(
  state: WorkspaceFilePersistedState,
  encryption: WorkspaceFileEncryption
): StoredWorkspaceFileState {
  const canEncrypt = encryption.isAvailable();
  return {
    version: 1,
    workspaces: state.workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      tabs: workspace.tabs.map((tab) => ({
        relativePath: tab.relativePath,
        ...(tab.baseRevision === undefined ? {} : { baseRevision: tab.baseRevision }),
        ...(tab.draft === undefined || !canEncrypt
          ? {}
          : { encryptedDraft: encryption.encrypt(tab.draft).toString("base64") })
      })),
      ...(workspace.activeRelativePath === undefined
        ? {}
        : { activeRelativePath: workspace.activeRelativePath })
    }))
  };
}

function decodeStoredState(
  stored: StoredWorkspaceFileState,
  encryption: WorkspaceFileEncryption
): { state: WorkspaceFilePersistedState; decryptFailed: boolean } {
  let decryptFailed = false;
  const state: WorkspaceFilePersistedState = {
    version: 1,
    workspaces: stored.workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      tabs: workspace.tabs.map((tab) => {
        if (tab.encryptedDraft === undefined) {
          return { relativePath: tab.relativePath };
        }
        if (!encryption.isAvailable()) {
          decryptFailed = true;
          return { relativePath: tab.relativePath };
        }
        try {
          return {
            relativePath: tab.relativePath,
            baseRevision: tab.baseRevision!,
            draft: encryption.decrypt(Buffer.from(tab.encryptedDraft, "base64"))
          };
        } catch {
          decryptFailed = true;
          return { relativePath: tab.relativePath };
        }
      }),
      ...(workspace.activeRelativePath === undefined
        ? {}
        : { activeRelativePath: workspace.activeRelativePath })
    }))
  };
  const parsed = parseWorkspaceFilePersistedState(state);
  return { state: parsed ?? emptyState(), decryptFailed: decryptFailed || parsed === undefined };
}

function emptyState(): WorkspaceFilePersistedState {
  return { version: 1, workspaces: [] };
}

function isWorkspaceId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 200
    && /^[A-Za-z0-9._:-]+$/u.test(value);
}

function isOpaqueRevision(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/u.test(value);
}

function isRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_WORKSPACE_FILE_PATH_CHARS
    || value.includes("\0")
    || value.includes("\\")
    || isAbsolute(value)
  ) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..")
    && segments[0] !== ".git";
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecordWithAllowedKeys(value, keys, keys);
}

function isRecordWithAllowedKeys(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[]
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.every((key) => allowedKeys.includes(key))
    && requiredKeys.every((key) => Object.hasOwn(value, key));
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
