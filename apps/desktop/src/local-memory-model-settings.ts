import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";

export interface LocalMemoryModelSettings {
  extraction: { provider: string; model: string };
  embedding: { protocol: "openai-compatible"; endpoint: string; model: string; dimension: number; apiKey: string };
}

function record(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !value.includes("\0");
}
function valid(value: unknown): value is LocalMemoryModelSettings {
  if (!record(value, ["extraction", "embedding"]) || !record(value.extraction, ["provider", "model"])
    || !record(value.embedding, ["protocol", "endpoint", "model", "dimension", "apiKey"])) return false;
  const { extraction, embedding } = value;
  if (!text(extraction.provider, 256) || !text(extraction.model, 512) || embedding.protocol !== "openai-compatible"
    || !text(embedding.endpoint, 2_048) || !text(embedding.model, 512) || !text(embedding.apiKey, 4_096)
    || typeof embedding.dimension !== "number" || !Number.isSafeInteger(embedding.dimension)
    || embedding.dimension < 1 || embedding.dimension > 65_536) return false;
  try {
    const endpoint = new URL(embedding.endpoint);
    return !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash
      && (endpoint.protocol === "https:" || (endpoint.protocol === "http:"
        && ["127.0.0.1", "[::1]"].includes(endpoint.hostname)));
  } catch { return false; }
}

/** Main-only settings, encrypted through the existing platform storage adapter.
 * Extraction stores only a Pi selection, never a copied Pi credential.
 */
export class LocalMemoryModelSettingsStore {
  readonly path: string;
  #tail: Promise<unknown> = Promise.resolve();
  #lifetime = new AbortController();
  /** Process-local settings generation; no persistent format or private restart change. */
  get signal(): AbortSignal { return this.#lifetime.signal; }
  constructor(private readonly root: string, private readonly encryption: DesktopTextEncryption) {
    if (!isAbsolute(root) || root.includes("\0")) throw new Error("Invalid memory settings root.");
    this.path = join(root, "models.enc.json");
  }

  load(): Promise<LocalMemoryModelSettings | undefined> {
    return this.#serialize(async () => {
      if (!await this.#directory(false)) return undefined;
      let metadata;
      try { metadata = await lstat(this.path); }
      catch (error) { if (hasCode(error, "ENOENT")) return undefined; throw new Error("Memory settings cannot be read."); }
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 32_768) throw new Error("Invalid memory settings file.");
      if (!this.encryption.isAvailable()) throw new Error("System secure storage is unavailable.");
      const handle = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await handle.stat();
        if (opened.ino !== metadata.ino || opened.dev !== metadata.dev || opened.size > 32_768) throw new Error("Memory settings changed during read.");
        const bytes = await handle.readFile("utf8");
        if (Buffer.byteLength(bytes) > 32_768) throw new Error("Invalid memory settings file.");
        const envelope: unknown = JSON.parse(bytes);
        if (!record(envelope, ["version", "ciphertext"]) || envelope.version !== 1
          || !text(envelope.ciphertext, 32_768) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(envelope.ciphertext)) {
          throw new Error("Invalid memory settings file.");
        }
        const value: unknown = JSON.parse(this.encryption.decrypt(Buffer.from(envelope.ciphertext, "base64")));
        if (!valid(value)) throw new Error("Invalid memory settings.");
        if (process.platform !== "win32") await handle.chmod(0o600);
        return value;
      } catch { throw new Error("Memory settings could not be decrypted or validated."); }
      finally { await handle.close(); }
    });
  }

  save(value: LocalMemoryModelSettings): Promise<void> {
    // Snapshot before queueing so caller mutation cannot swap credentials/targets.
    if (!valid(value)) return Promise.reject(new Error("Invalid memory model settings."));
    const plaintext = JSON.stringify(value);
    const pending = this.#serialize(async () => {
      if (!this.encryption.isAvailable()) throw new Error("System secure storage is unavailable.");
      let serialized: string;
      try { serialized = JSON.stringify({ version: 1, ciphertext: this.encryption.encrypt(plaintext).toString("base64") }); }
      catch { throw new Error("Memory settings could not be encrypted."); }
      if (Buffer.byteLength(serialized) > 32_768) throw new Error("Memory settings exceed the storage limit.");
      await this.#directory(true);
      try {
        const current = await lstat(this.path);
        if (!current.isFile() || current.isSymbolicLink()) throw new Error("Unsafe memory settings target.");
      } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
      const temporary = join(this.root, `.models-${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      let moved = false;
      try {
        try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, this.path); moved = true;
        if (process.platform !== "win32") {
          const directory = await open(this.root, "r");
          try { await directory.sync(); } finally { await directory.close(); }
        }
      } finally { if (!moved) await unlink(temporary); }
    });
    // Enqueue first: invalidation listeners may read, and must queue behind this
    // write rather than capture the old file under the new generation.
    const previous = this.#lifetime; this.#lifetime = new AbortController(); previous.abort();
    return pending;
  }

  async #directory(create: boolean): Promise<boolean> {
    if (create) await mkdir(this.root, { recursive: true, mode: 0o700 });
    let metadata;
    try { metadata = await lstat(this.root); }
    catch (error) { if (hasCode(error, "ENOENT")) return false; throw error; }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("Unsafe memory settings directory.");
    if (process.platform !== "win32") await chmod(this.root, 0o700);
    return true;
  }
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.#tail.then(operation, operation);
    this.#tail = pending.then(() => undefined, () => undefined);
    return pending;
  }
}
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
