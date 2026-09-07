import { lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const REPOSITORY_ID = /^repo_[0-9a-f]{32}$/u;

/** Presence means an explicit Repository action has not confirmed its completion. */
export class RepositoryActionFenceStore {
  readonly #directory: string;

  constructor(userData: string) {
    this.#directory = join(userData, "repository-action-fences");
  }

  async load(): Promise<string[]> {
    if (!await this.#verifyDirectory()) return [];
    const entries = await readdir(this.#directory, { withFileTypes: true });
    if (entries.some((entry) => !entry.isFile() || !REPOSITORY_ID.test(entry.name))) {
      throw new Error("Repository action fence store is invalid.");
    }
    return entries.map((entry) => entry.name);
  }

  async begin(repositoryId: string): Promise<void> {
    const path = this.#path(repositoryId);
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await this.#verifyDirectory();
    // Exclusive creation refuses to overwrite a prior unresolved operation.
    const file = await open(path, "wx", 0o600);
    try { await file.sync(); } finally { await file.close(); }
  }

  async complete(repositoryId: string): Promise<void> {
    await unlink(this.#path(repositoryId));
  }

  #path(repositoryId: string): string {
    if (!REPOSITORY_ID.test(repositoryId)) throw new Error("Invalid Repository identity.");
    return join(this.#directory, repositoryId);
  }

  async #verifyDirectory(): Promise<boolean> {
    try {
      const entry = await lstat(this.#directory);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Invalid Repository fence directory.");
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    }
  }
}
