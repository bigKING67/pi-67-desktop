import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { withConfigurationFileLock, writePrivateFileAtomically } from "./atomic-private-file.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";

const LEGACY_RECEIPT_VERSION = 1;
export const SESSION_CREATION_JOURNAL_VERSION = 1;
const MAX_JOURNAL_BYTES = 64 * 1024;
const MAX_DIAGNOSTIC_JOURNAL_ENTRIES = 2_048;

interface LegacySessionCreationReceipt {
  version: typeof LEGACY_RECEIPT_VERSION;
  creationId: string;
  workspaceKey: string;
  sessionId: string;
  sessionPath: string;
}

export type SessionCreationJournalState =
  | "reserved"
  | "materializing"
  | "materialized"
  | "published"
  | "acknowledged"
  | "ambiguous"
  | "abandoned";

export interface SessionCreationJournalEntry {
  version: typeof SESSION_CREATION_JOURNAL_VERSION;
  creationId: string;
  workspaceKey: string;
  state: SessionCreationJournalState;
  sessionId?: string;
  sessionPath?: string;
  sessionFileIdentity?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionCreationJournalOptions {
  cwd: string;
  agentDir: string;
  storageRoot?: string;
  now?: () => number;
}

export interface SessionCreationJournalDiagnostics {
  entryCount: number;
  stateCounts: Record<SessionCreationJournalState, number>;
  invalidEntryCount: number;
  truncated: boolean;
}

/** Atomic storage and per-creation locking for the Session creation state machine. */
export class SessionCreationJournal {
  readonly workspaceKey: string;
  private readonly journalDirectory: string | undefined;
  private readonly legacyReceiptDirectory: string | undefined;
  private readonly memoryEntries = new Map<string, SessionCreationJournalEntry>();
  private readonly memoryLocks = new Map<string, Promise<void>>();
  private readonly now: () => number;

  constructor(options: SessionCreationJournalOptions) {
    const cwd = resolve(options.cwd);
    const agentDir = resolve(options.agentDir);
    this.workspaceKey = createHash("sha256")
      .update(normalizeSessionCatalogPathIdentity(cwd))
      .update("\0")
      .update(normalizeSessionCatalogPathIdentity(agentDir))
      .digest("hex");
    this.journalDirectory = options.storageRoot === undefined
      ? undefined
      : join(options.storageRoot, "session-creation-journal-v1");
    this.legacyReceiptDirectory = options.storageRoot === undefined
      ? undefined
      : join(options.storageRoot, "session-creation-receipts-v1");
    this.now = options.now ?? Date.now;
  }

  timestamp(): number {
    return this.now();
  }

  assertWorkspace(entry: SessionCreationJournalEntry): void {
    if (entry.workspaceKey === this.workspaceKey) return;
    throw new Error("The Session creation id belongs to another Workspace journal.");
  }

  async readUnlocked(creationId: string): Promise<SessionCreationJournalEntry | undefined> {
    if (!this.journalDirectory) return this.memoryEntries.get(creationId);
    const journal = await readStoredEntry(this.journalPath(creationId)!, creationId, isJournalEntry);
    if (journal) return journal;
    const legacy = await readStoredEntry(
      this.legacyReceiptPath(creationId)!,
      creationId,
      isLegacyReceipt
    );
    if (!legacy) return undefined;
    const now = this.now();
    return {
      version: SESSION_CREATION_JOURNAL_VERSION,
      creationId: legacy.creationId,
      workspaceKey: legacy.workspaceKey,
      state: "materialized",
      sessionId: legacy.sessionId,
      sessionPath: legacy.sessionPath,
      createdAt: now,
      updatedAt: now
    };
  }

  async writeUnlocked(entry: SessionCreationJournalEntry): Promise<void> {
    if (!isJournalEntry(entry)) throw new Error("Invalid Session creation journal entry.");
    if (!this.journalDirectory) {
      this.memoryEntries.set(entry.creationId, { ...entry });
      return;
    }
    const serialized = `${JSON.stringify(entry)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_JOURNAL_BYTES) {
      throw new Error("The Session creation journal entry exceeds its storage limit.");
    }
    const path = this.journalPath(entry.creationId)!;
    await writePrivateFileAtomically(path, serialized);
    if (process.platform !== "win32") await chmod(path, 0o600);
  }

  async withLock<T>(creationId: string, operation: () => Promise<T>): Promise<T> {
    const path = this.journalPath(creationId);
    if (!path) return this.withMemoryLock(creationId, operation);
    await mkdir(this.journalDirectory!, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(this.journalDirectory!, 0o700);
    return withConfigurationFileLock(path, operation);
  }

  async diagnostics(): Promise<SessionCreationJournalDiagnostics> {
    const result = emptyJournalDiagnostics();
    if (!this.journalDirectory) {
      for (const entry of this.memoryEntries.values()) this.includeDiagnosticEntry(result, entry);
      return result;
    }
    const entries = await readdir(this.journalDirectory, { withFileTypes: true }).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) return [];
      throw error;
    });
    const candidates = entries.filter((entry) => entry.name.endsWith(".json"));
    result.truncated = candidates.length > MAX_DIAGNOSTIC_JOURNAL_ENTRIES;
    for (const entry of candidates.slice(0, MAX_DIAGNOSTIC_JOURNAL_ENTRIES)) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        result.invalidEntryCount += 1;
        continue;
      }
      const value = await readDiagnosticEntry(join(this.journalDirectory, entry.name));
      if (!value) {
        result.invalidEntryCount += 1;
        continue;
      }
      this.includeDiagnosticEntry(result, value);
    }
    return result;
  }

  private async withMemoryLock<T>(creationId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.memoryLocks.get(creationId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const tail = previous.then(() => gate);
    this.memoryLocks.set(creationId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.memoryLocks.get(creationId) === tail) this.memoryLocks.delete(creationId);
    }
  }

  private journalPath(creationId: string): string | undefined {
    return this.hashedStoragePath(this.journalDirectory, creationId);
  }

  private legacyReceiptPath(creationId: string): string | undefined {
    return this.hashedStoragePath(this.legacyReceiptDirectory, creationId);
  }

  private hashedStoragePath(directory: string | undefined, creationId: string): string | undefined {
    if (!directory) return undefined;
    const name = createHash("sha256").update(creationId, "utf8").digest("hex");
    return join(directory, `${name}.json`);
  }

  private includeDiagnosticEntry(
    result: SessionCreationJournalDiagnostics,
    entry: SessionCreationJournalEntry
  ): void {
    if (entry.workspaceKey !== this.workspaceKey) return;
    result.entryCount += 1;
    result.stateCounts[entry.state] += 1;
  }
}

export function assertSessionCreationId(value: string): void {
  if (!isCreationId(value)) throw new Error("Invalid Session creation id.");
}

function isJournalEntry(value: unknown): value is SessionCreationJournalEntry {
  return isRecord(value)
    && value.version === SESSION_CREATION_JOURNAL_VERSION
    && isCreationId(value.creationId)
    && typeof value.workspaceKey === "string"
    && /^[0-9a-f]{64}$/u.test(value.workspaceKey)
    && isJournalState(value.state)
    && optionalBoundedString(value.sessionId, 1_024)
    && optionalBoundedString(value.sessionPath, 32_768)
    && optionalBoundedString(value.sessionFileIdentity, 65_536)
    && ((value.sessionId === undefined) === (value.sessionPath === undefined))
    && (value.sessionFileIdentity === undefined || value.sessionPath !== undefined)
    && isTimestamp(value.createdAt)
    && isTimestamp(value.updatedAt)
    && value.updatedAt >= value.createdAt;
}

function isLegacyReceipt(value: unknown): value is LegacySessionCreationReceipt {
  return isRecord(value)
    && value.version === LEGACY_RECEIPT_VERSION
    && isCreationId(value.creationId)
    && typeof value.workspaceKey === "string"
    && /^[0-9a-f]{64}$/u.test(value.workspaceKey)
    && typeof value.sessionId === "string"
    && value.sessionId.length > 0
    && value.sessionId.length <= 1_024
    && typeof value.sessionPath === "string"
    && value.sessionPath.length > 0
    && value.sessionPath.length <= 32_768;
}

async function readStoredEntry<T extends { creationId: string }>(
  path: string,
  creationId: string,
  validate: (value: unknown) => value is T
): Promise<T | undefined> {
  const info = await lstat(path).catch((error: unknown) => (
    isNodeError(error, "ENOENT") ? undefined : Promise.reject(error)
  ));
  if (!info) return undefined;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1 || info.size > MAX_JOURNAL_BYTES) {
    await quarantine(path);
    return undefined;
  }
  try {
    if (process.platform !== "win32") await chmod(path, 0o600);
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!validate(parsed) || parsed.creationId !== creationId) {
      throw new Error("Invalid Session creation journal entry.");
    }
    return parsed;
  } catch {
    await quarantine(path);
    return undefined;
  }
}

async function readDiagnosticEntry(path: string): Promise<SessionCreationJournalEntry | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1 || info.size > MAX_JOURNAL_BYTES) {
      return undefined;
    }
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isJournalEntry(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function emptyJournalDiagnostics(): SessionCreationJournalDiagnostics {
  return {
    entryCount: 0,
    stateCounts: {
      reserved: 0,
      materializing: 0,
      materialized: 0,
      published: 0,
      acknowledged: 0,
      ambiguous: 0,
      abandoned: 0
    },
    invalidEntryCount: 0,
    truncated: false
  };
}

function isJournalState(value: unknown): value is SessionCreationJournalState {
  return value === "reserved"
    || value === "materializing"
    || value === "materialized"
    || value === "published"
    || value === "acknowledged"
    || value === "ambiguous"
    || value === "abandoned";
}

function isCreationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

function optionalBoundedString(value: unknown, maximum: number): boolean {
  return value === undefined
    || (typeof value === "string" && value.length > 0 && value.length <= maximum);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

async function quarantine(path: string): Promise<void> {
  await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
