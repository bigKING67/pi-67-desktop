import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  isEnterpriseAccessCredential,
  type EnterpriseAccessCredential
} from "@pi67/protocol";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";

const MAX_STORED_BYTES = 32 * 1_024;
const STORE_DIRECTORY = "runtime";
const STORE_FILENAME = "enterprise-context-credential-v1.json";

interface StoredCredential {
  version: 1;
  encryptedCredential: string;
}

export interface EnterpriseCredentialStoreSnapshot {
  storage: "available" | "unavailable";
  credential?: EnterpriseAccessCredential;
}

export class EnterpriseCredentialStore {
  readonly path: string;
  readonly #directory: string;
  readonly #encryption: DesktopTextEncryption;
  #pending: Promise<void> = Promise.resolve();

  constructor(userData: string, options: { encryption: DesktopTextEncryption }) {
    if (!userData || userData.includes("\0")) throw new Error("Electron userData path is invalid.");
    this.#directory = join(resolve(userData), STORE_DIRECTORY);
    this.path = join(this.#directory, STORE_FILENAME);
    this.#encryption = options.encryption;
  }

  load(): Promise<EnterpriseCredentialStoreSnapshot> {
    return this.#enqueue(async () => {
      const directoryState = await this.#directoryState(false);
      if (directoryState === "unsafe") return { storage: "unavailable" };
      if (directoryState === "missing") return { storage: "available" };
      let metadata;
      try {
        metadata = await lstat(this.path);
      } catch (error) {
        if (isNodeError(error, "ENOENT")) return { storage: "available" };
        throw error;
      }
      if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_STORED_BYTES) {
        return { storage: "available" };
      }
      const handle = await open(this.path, "r");
      let serialized: string;
      try {
        serialized = await handle.readFile({ encoding: "utf8" });
      } finally {
        await handle.close();
      }
      if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_BYTES) return { storage: "available" };
      try {
        const stored = parseStoredCredential(JSON.parse(serialized) as unknown);
        if (!stored) return { storage: "available" };
        if (!this.#encryption.isAvailable()) return { storage: "unavailable" };
        const decrypted = this.#encryption.decrypt(Buffer.from(stored.encryptedCredential, "base64"));
        const credential = JSON.parse(decrypted) as unknown;
        if (!isEnterpriseAccessCredential(credential)) return { storage: "available" };
        if (process.platform !== "win32") await chmod(this.path, 0o600);
        return { storage: "available", credential };
      } catch {
        return { storage: "available" };
      }
    });
  }

  store(credential: EnterpriseAccessCredential): Promise<void> {
    return this.#enqueue(async () => {
      if (!isEnterpriseAccessCredential(credential)) throw new Error("Enterprise credential is invalid.");
      if (!this.#encryption.isAvailable()) throw unavailableError();
      const encryptedCredential = this.#encryption.encrypt(JSON.stringify(credential)).toString("base64");
      const serialized = `${JSON.stringify({ version: 1, encryptedCredential } satisfies StoredCredential)}\n`;
      if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_BYTES) {
        throw new Error("Enterprise credential exceeds the persistence size limit.");
      }
      if (await this.#directoryState(true) !== "safe") {
        throw new Error("Enterprise credential directory is not a safe local directory.");
      }
      const temporaryPath = join(
        dirname(this.path),
        `.${basename(this.path)}.${process.pid}.${randomUUID()}.tmp`
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
        await rename(temporaryPath, this.path);
        temporaryExists = false;
        if (process.platform !== "win32") await chmod(this.path, 0o600);
      } finally {
        if (temporaryExists) await unlink(temporaryPath).catch(() => undefined);
      }
    });
  }

  clear(): Promise<void> {
    return this.#enqueue(async () => {
      const directoryState = await this.#directoryState(false);
      if (directoryState === "missing") return;
      if (directoryState === "unsafe") {
        throw new Error("Enterprise credential directory is not a safe local directory.");
      }
      await unlink(this.path).catch((error) => {
        if (!isNodeError(error, "ENOENT")) throw error;
      });
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation, operation);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async #directoryState(create: boolean): Promise<"safe" | "missing" | "unsafe"> {
    if (create) await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    let metadata;
    try {
      metadata = await lstat(this.#directory);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return "missing";
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) return "unsafe";
    if (process.platform !== "win32") await chmod(this.#directory, 0o700);
    return "safe";
  }
}

function parseStoredCredential(value: unknown): StoredCredential | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || record.version !== 1) return undefined;
  if (typeof record.encryptedCredential !== "string" || record.encryptedCredential.length > MAX_STORED_BYTES) {
    return undefined;
  }
  return { version: 1, encryptedCredential: record.encryptedCredential };
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function unavailableError(): Error {
  return new Error("System secure storage is unavailable.");
}
