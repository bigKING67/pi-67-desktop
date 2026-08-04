import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConversationOrganization } from "@pi67/domain";
import { writePrivateFileAtomically } from "./atomic-private-file.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";

const MAX_RECORDS = 10_000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

interface StoredRecord extends ConversationOrganization {
  sessionKey: string;
}

interface StoredDocument {
  version: 1;
  records: StoredRecord[];
}

export class ConversationOrganizationStore {
  private readonly records = new Map<string, ConversationOrganization>();
  private readonly path: string | undefined;
  private ready: Promise<void> | undefined;

  constructor(storageRoot?: string) {
    this.path = storageRoot === undefined
      ? undefined
      : join(storageRoot, "conversation-organization", "organization-v1.json");
  }

  async initialize(): Promise<void> {
    this.ready ??= this.load();
    await this.ready;
  }

  get(sourceKey: string, path: string): ConversationOrganization {
    return { ...this.records.get(sessionKey(sourceKey, path)) };
  }

  async set(sourceKey: string, path: string, value: ConversationOrganization): Promise<void> {
    await this.initialize();
    const key = sessionKey(sourceKey, path);
    const previous = this.records.get(key);
    if (value.pinnedAt === undefined && value.archivedAt === undefined) this.records.delete(key);
    else this.records.set(key, { ...value });
    try {
      if (this.records.size > MAX_RECORDS) {
        throw new Error("Conversation organization storage reached its record limit.");
      }
      await this.persist();
    } catch (error) {
      if (previous === undefined) this.records.delete(key);
      else this.records.set(key, previous);
      throw error;
    }
  }

  private async load(): Promise<void> {
    if (!this.path) return;
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(directory, 0o700);
    const info = await lstat(this.path).catch((error: unknown) => (
      isNodeError(error, "ENOENT") ? undefined : Promise.reject(error)
    ));
    if (!info) return;
    if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1 || info.size > MAX_FILE_BYTES) {
      await this.quarantine();
      return;
    }
    try {
      if (process.platform !== "win32") await chmod(this.path, 0o600);
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      if (!isStoredDocument(parsed)) throw new Error("Invalid conversation organization document.");
      for (const record of parsed.records) {
        const value: ConversationOrganization = {};
        if (record.pinnedAt !== undefined) value.pinnedAt = record.pinnedAt;
        if (record.archivedAt !== undefined) value.archivedAt = record.archivedAt;
        this.records.set(record.sessionKey, value);
      }
    } catch {
      this.records.clear();
      await this.quarantine();
    }
  }

  private async persist(): Promise<void> {
    if (!this.path) return;
    const document: StoredDocument = {
      version: 1,
      records: [...this.records].map(([sessionKey, value]) => ({ sessionKey, ...value }))
    };
    const serialized = `${JSON.stringify(document)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_FILE_BYTES) {
      throw new Error("Conversation organization storage reached its size limit.");
    }
    await writePrivateFileAtomically(this.path, serialized);
    if (process.platform !== "win32") await chmod(this.path, 0o600);
  }

  private async quarantine(): Promise<void> {
    if (!this.path) return;
    await rename(this.path, `${this.path}.corrupt-${Date.now()}`).catch(() => undefined);
  }
}

function sessionKey(sourceKey: string, path: string): string {
  return createHash("sha256")
    .update(sourceKey)
    .update("\0")
    .update(normalizeSessionCatalogPathIdentity(path))
    .digest("hex");
}

function isStoredDocument(value: unknown): value is StoredDocument {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.records) || value.records.length > MAX_RECORDS) {
    return false;
  }
  return value.records.every((record) => isRecord(record)
    && typeof record.sessionKey === "string"
    && /^[0-9a-f]{64}$/u.test(record.sessionKey)
    && validTimestamp(record.pinnedAt)
    && validTimestamp(record.archivedAt));
}

function validTimestamp(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
