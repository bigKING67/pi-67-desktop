import { randomUUID } from "node:crypto";
import { realpath } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  LEGACY_WORKBENCH_STATE_FILENAME,
  MAX_WORKBENCH_STATE_BYTES,
  WORKBENCH_STATE_DIRECTORY,
  WORKBENCH_STATE_FILENAME,
  WORKBENCH_STATE_VERSION,
  UnsupportedWorkbenchStateVersionError,
  createEmptyWorkbenchState,
  parseWorkbenchStateV2,
  type WorkbenchLoadResult,
  type WorkbenchStateV2
} from "./workbench-state-contract.js";
import { parseAndMigrateWorkbenchStateV1 } from "./workbench-state-v1.js";

export * from "./workbench-state-contract.js";
export * from "./workbench-state-mutations.js";

const realpathNative = promisify(realpath.native);

export interface WorkbenchStateStoreOptions {
  now?: () => number;
  createToken?: () => string;
}

export class WorkbenchStateStore {
  readonly requestedStatePath: string;
  readonly #requestedUserData: string;
  readonly #now: () => number;
  readonly #createToken: () => string;
  #pending: Promise<void> = Promise.resolve();

  constructor(userData: string, options: WorkbenchStateStoreOptions = {}) {
    if (typeof userData !== "string" || userData.length === 0 || userData.includes("\0")) {
      throw new Error("Electron userData path is invalid.");
    }
    this.#requestedUserData = resolve(userData);
    this.requestedStatePath = join(this.#requestedUserData, WORKBENCH_STATE_DIRECTORY, WORKBENCH_STATE_FILENAME);
    this.#now = options.now ?? Date.now;
    this.#createToken = options.createToken ?? randomUUID;
  }

  load(): Promise<WorkbenchLoadResult> {
    return this.#enqueue(() => this.#loadUnlocked());
  }

  update(mutator: (current: WorkbenchStateV2) => WorkbenchStateV2): Promise<WorkbenchStateV2> {
    return this.#enqueue(async () => {
      const loaded = await this.#loadUnlocked();
      const next = mutator(structuredClone(loaded.state));
      const validated = parseWorkbenchStateV2(next);
      if (!validated) throw new Error("Workbench state update is invalid.");
      await this.#writeUnlocked(validated);
      return structuredClone(validated);
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation, operation);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async #loadUnlocked(): Promise<WorkbenchLoadResult> {
    const directory = await this.#ensureStorageDirectory();
    const currentPath = join(directory, WORKBENCH_STATE_FILENAME);
    const current = await this.#readStateFile(currentPath);
    if (current.kind === "missing") return this.#loadLegacyOrEmpty(directory);
    if (current.kind === "invalid") return this.#quarantineCorruptState(currentPath);
    const version = readStateVersion(current.value);
    if (version !== undefined && version > WORKBENCH_STATE_VERSION) {
      throw new UnsupportedWorkbenchStateVersionError(version);
    }
    const state = parseWorkbenchStateV2(current.value);
    if (!state) return this.#quarantineCorruptState(currentPath);
    if (process.platform !== "win32") await chmod(currentPath, 0o600);
    return { state: structuredClone(state) };
  }

  async #loadLegacyOrEmpty(directory: string): Promise<WorkbenchLoadResult> {
    const legacyPath = join(directory, LEGACY_WORKBENCH_STATE_FILENAME);
    const legacy = await this.#readStateFile(legacyPath);
    if (legacy.kind === "missing") return { state: createEmptyWorkbenchState() };
    if (legacy.kind === "invalid") return this.#quarantineCorruptState(legacyPath);
    const version = readStateVersion(legacy.value);
    if (version !== undefined && version > WORKBENCH_STATE_VERSION) {
      throw new UnsupportedWorkbenchStateVersionError(version);
    }
    const migrated = parseAndMigrateWorkbenchStateV1(legacy.value);
    if (!migrated) return this.#quarantineCorruptState(legacyPath);
    await this.#writeUnlocked(migrated);
    if (process.platform !== "win32") await chmod(legacyPath, 0o600);
    return { state: structuredClone(migrated), recovery: { kind: "migrated-v1" } };
  }

  async #readStateFile(path: string): Promise<
    | { kind: "missing" }
    | { kind: "invalid" }
    | { kind: "value"; value: unknown }
  > {
    let fileMetadata;
    try {
      fileMetadata = await lstat(path);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return { kind: "missing" };
      throw error;
    }
    if (fileMetadata.isSymbolicLink() || !fileMetadata.isFile()) return { kind: "invalid" };

    let serialized: string | undefined;
    try {
      const handle = await open(path, "r");
      try {
        const metadata = await handle.stat();
        if (metadata.size <= MAX_WORKBENCH_STATE_BYTES) serialized = await handle.readFile({ encoding: "utf8" });
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return { kind: "missing" };
      throw error;
    }
    if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > MAX_WORKBENCH_STATE_BYTES) {
      return { kind: "invalid" };
    }
    try {
      return { kind: "value", value: JSON.parse(serialized) as unknown };
    } catch {
      return { kind: "invalid" };
    }
  }

  async #writeUnlocked(state: WorkbenchStateV2): Promise<void> {
    const serialized = `${JSON.stringify(state)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_WORKBENCH_STATE_BYTES) {
      throw new Error("Workbench state exceeds the persistence size limit.");
    }
    const directory = await this.#ensureStorageDirectory();
    const statePath = join(directory, WORKBENCH_STATE_FILENAME);
    const temporaryPath = join(directory, `.${WORKBENCH_STATE_FILENAME}.${process.pid}.${this.#createToken()}.tmp`);
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

  async #quarantineCorruptState(statePath: string): Promise<WorkbenchLoadResult> {
    const fileStem = basename(statePath, ".json");
    const prefix = `${fileStem}.corrupt-${this.#now()}-${this.#createToken()}`;
    let quarantinePath: string | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = join(dirname(statePath), `${prefix}${attempt === 0 ? "" : `-${attempt}`}.json`);
      try {
        await lstat(candidate);
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) throw error;
        quarantinePath = candidate;
        break;
      }
    }
    if (!quarantinePath) throw new Error("Workbench corrupt-state quarantine limit reached.");
    try {
      await rename(statePath, quarantinePath);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return { state: createEmptyWorkbenchState() };
      throw error;
    }
    return {
      state: createEmptyWorkbenchState(),
      recovery: { kind: "corrupt-reset", quarantinedFileName: basename(quarantinePath) }
    };
  }

  async #ensureStorageDirectory(): Promise<string> {
    await mkdir(this.#requestedUserData, { recursive: true, mode: 0o700 });
    const canonicalUserData = await realpathNative(this.#requestedUserData);
    const requestedDirectory = join(canonicalUserData, WORKBENCH_STATE_DIRECTORY);
    try {
      const metadata = await lstat(requestedDirectory);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error("Workbench storage path must be a real directory.");
      }
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
      await mkdir(requestedDirectory, { mode: 0o700 });
    }
    const canonicalDirectory = await realpathNative(requestedDirectory);
    if (!isContained(canonicalDirectory, canonicalUserData)) {
      throw new Error("Workbench storage escaped the Electron userData directory.");
    }
    if (process.platform !== "win32") await chmod(canonicalDirectory, 0o700);
    return canonicalDirectory;
  }
}

function readStateVersion(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const version = Reflect.get(value, "version");
  return typeof version === "number" && Number.isSafeInteger(version) && version >= 0 ? version : undefined;
}

function isContained(candidate: string, root: string): boolean {
  const fromRoot = relative(normalizePath(root), normalizePath(candidate));
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function normalizePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
