import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/** One non-secret opt-in bit, separate from model settings and hosted identity. */
export class LocalMemoryActivationStore {
  readonly #path: string;
  constructor(private readonly root: string) {
    if (!isAbsolute(root) || root.includes("\0")) throw new Error("Invalid memory activation root.");
    this.#path = join(root, "activation.json");
  }
  async load(): Promise<boolean> {
    if (!await this.#directory()) return false;
    const metadata = await this.#file();
    if (!metadata) return false;
    const handle = await open(this.#path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const current = await handle.stat();
      if (current.ino !== metadata.ino || current.dev !== metadata.dev) throw new Error("Activation file changed.");
      const buffer = Buffer.alloc(257);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 256) throw new Error("Activation file is too large.");
      const value: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).length !== 2 || !("version" in value) || value.version !== 1
        || !("enabled" in value) || typeof value.enabled !== "boolean") throw new Error("Invalid activation file.");
      return value.enabled;
    } finally { await handle.close(); }
  }
  async save(enabled: boolean): Promise<void> {
    if (typeof enabled !== "boolean" || !await this.#directory()) throw new Error("Activation storage is unavailable.");
    await this.#file();
    const temporary = join(this.root, `.activation-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    let moved = false;
    try {
      try { await handle.writeFile(JSON.stringify({ version: 1, enabled })); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, this.#path); moved = true;
      const directory = await open(this.root, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { if (!moved) await unlink(temporary); }
  }
  async #directory(): Promise<boolean> {
    let entry;
    try { entry = await lstat(this.root); } catch (error) { if (missing(error)) return false; throw error; }
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== process.getuid?.() || (entry.mode & 0o022)) {
      throw new Error("Unsafe activation directory.");
    }
    return true;
  }
  async #file() {
    let entry;
    try { entry = await lstat(this.#path); } catch (error) { if (missing(error)) return undefined; throw error; }
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.uid !== process.getuid?.()
      || (entry.mode & 0o077) || entry.size > 256) throw new Error("Unsafe activation file.");
    return entry;
  }
}
function missing(error: unknown) { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
