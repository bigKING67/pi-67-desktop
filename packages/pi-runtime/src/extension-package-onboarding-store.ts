import { chmod, lstat, mkdir, readFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  ExtensionPackageOnboardingResult,
  ExtensionPackageOnboardingState,
  ExtensionPackageScope
} from "@pi67/domain";
import { writePrivateFileAtomically } from "./atomic-private-file.js";

const DOCUMENT_VERSION = 1;
const MAX_DOCUMENT_BYTES = 64 * 1024;
const MAX_RECORDS = 64;

interface StoredRecord extends ExtensionPackageOnboardingResult {
  updatedAt: number;
}

interface StoredDocument {
  version: typeof DOCUMENT_VERSION;
  records: StoredRecord[];
}

export interface ExtensionPackageOnboardingStoreOptions {
  storageRoot?: string;
  freshProfile: boolean;
  now?: () => number;
}

/** Persists one-time package onboarding decisions outside renderer storage. */
export class ExtensionPackageOnboardingStore {
  readonly #path: string | undefined;
  readonly #freshProfile: boolean;
  readonly #now: () => number;
  readonly #records = new Map<string, StoredRecord>();
  #ready: Promise<void> | undefined;
  #writeQueue = Promise.resolve();

  constructor(options: ExtensionPackageOnboardingStoreOptions) {
    this.#path = options.storageRoot === undefined
      ? undefined
      : join(resolve(options.storageRoot), "extension-package-onboarding-v1", "state.json");
    this.#freshProfile = options.freshProfile;
    this.#now = options.now ?? Date.now;
  }

  async status(
    source: string,
    scope: ExtensionPackageScope,
    installed: boolean
  ): Promise<ExtensionPackageOnboardingResult> {
    return this.#mutate(async () => {
      const key = recordKey(source, scope);
      const current = this.#records.get(key);
      let state = current?.state;
      if (installed && state !== "installed") state = current ? "installed" : "suppressed-existing";
      else if (!installed && state === "installing") state = "install-failed";
      else state ??= this.#freshProfile ? "unseen" : "suppressed-existing";
      if (!current || current.state !== state) {
        this.#records.set(key, { source, scope, state, updatedAt: this.#timestamp() });
        await this.#persist();
      }
      return { source, scope, state };
    });
  }

  async decline(source: string, scope: ExtensionPackageScope): Promise<ExtensionPackageOnboardingResult> {
    return this.#set(source, scope, "declined", new Set(["unseen", "install-failed", "declined"]));
  }

  async markInstalling(source: string, scope: ExtensionPackageScope): Promise<void> {
    await this.#set(source, scope, "installing", new Set(["unseen", "install-failed", "installing"]));
  }

  async markInstalled(source: string, scope: ExtensionPackageScope): Promise<void> {
    await this.#set(source, scope, "installed");
  }

  async markInstallFailed(source: string, scope: ExtensionPackageScope): Promise<void> {
    await this.#set(source, scope, "install-failed", new Set(["installing", "install-failed"]));
  }

  async #set(
    source: string,
    scope: ExtensionPackageScope,
    state: ExtensionPackageOnboardingState,
    allowed?: ReadonlySet<ExtensionPackageOnboardingState>
  ): Promise<ExtensionPackageOnboardingResult> {
    return this.#mutate(async () => {
      const key = recordKey(source, scope);
      const current = this.#records.get(key);
      if (current && allowed && !allowed.has(current.state)) {
        return { source, scope, state: current.state };
      }
      if (!current && allowed && !allowed.has("unseen")) {
        return { source, scope, state: this.#freshProfile ? "unseen" : "suppressed-existing" };
      }
      if (current?.state !== state) {
        if (this.#records.size >= MAX_RECORDS && !current) throw new Error("Extension package onboarding storage is full.");
        this.#records.set(key, { source, scope, state, updatedAt: this.#timestamp() });
        await this.#persist();
      }
      return { source, scope, state };
    });
  }

  async #mutate<T>(operation: () => Promise<T>): Promise<T> {
    await (this.#ready ??= this.#load());
    const predecessor = this.#writeQueue;
    let release!: () => void;
    this.#writeQueue = new Promise<void>((resolveWrite) => { release = resolveWrite; });
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async #load(): Promise<void> {
    if (!this.#path) return;
    const directory = dirname(this.#path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(directory, 0o700);
    const info = await lstat(this.#path).catch((error: unknown) => (
      nodeErrorCode(error) === "ENOENT" ? undefined : Promise.reject(error)
    ));
    if (!info) return;
    if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1 || info.size > MAX_DOCUMENT_BYTES) {
      await this.#quarantine();
      return;
    }
    try {
      const value = JSON.parse(await readFile(this.#path, "utf8")) as unknown;
      if (!isStoredDocument(value)) throw new Error("Invalid Extension package onboarding state.");
      for (const record of value.records) this.#records.set(recordKey(record.source, record.scope), record);
    } catch {
      this.#records.clear();
      await this.#quarantine();
    }
  }

  async #persist(): Promise<void> {
    if (!this.#path) return;
    const document: StoredDocument = { version: DOCUMENT_VERSION, records: [...this.#records.values()] };
    const serialized = `${JSON.stringify(document)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_DOCUMENT_BYTES) {
      throw new Error("Extension package onboarding storage reached its size limit.");
    }
    await writePrivateFileAtomically(this.#path, serialized);
    if (process.platform !== "win32") await chmod(this.#path, 0o600);
  }

  async #quarantine(): Promise<void> {
    if (!this.#path) return;
    await rename(this.#path, `${this.#path}.corrupt-${this.#timestamp()}`).catch(() => undefined);
  }

  #timestamp(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Extension package onboarding timestamp is invalid.");
    return value;
  }
}

function isStoredDocument(value: unknown): value is StoredDocument {
  return isRecord(value)
    && value.version === DOCUMENT_VERSION
    && Array.isArray(value.records)
    && value.records.length <= MAX_RECORDS
    && value.records.every(isStoredRecord)
    && new Set(value.records.map((record) => recordKey(record.source, record.scope))).size === value.records.length;
}

function isStoredRecord(value: unknown): value is StoredRecord {
  return isRecord(value)
    && hasOnlyKeys(value, ["source", "scope", "state", "updatedAt"])
    && typeof value.source === "string"
    && value.source.length > 0
    && value.source.length <= 4_096
    && !value.source.includes("\0")
    && (value.scope === "global" || value.scope === "project")
    && isOnboardingState(value.state)
    && typeof value.updatedAt === "number"
    && Number.isSafeInteger(value.updatedAt)
    && value.updatedAt >= 0;
}

function isOnboardingState(value: unknown): value is ExtensionPackageOnboardingState {
  return value === "unseen"
    || value === "installing"
    || value === "installed"
    || value === "declined"
    || value === "install-failed"
    || value === "suppressed-existing";
}

function recordKey(source: string, scope: ExtensionPackageScope): string {
  return `${scope}\0${source}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function nodeErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}
