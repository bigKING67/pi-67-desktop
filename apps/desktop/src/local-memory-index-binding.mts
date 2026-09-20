import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, readdir, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

interface EmbeddingIdentity {
  protocol: "openai-compatible";
  endpoint: string;
  model: string;
  dimension: number;
}

/** Credentials are deliberately excluded: key rotation does not rebuild vectors. */
export async function bindLocalMemoryIndex(root: string, embedding: EmbeddingIdentity): Promise<void> {
  if (!isAbsolute(root)) throw new Error("Local index requires an absolute data root.");
  const endpoint = new URL(embedding.endpoint);
  if (embedding.protocol !== "openai-compatible" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:"
      && ["127.0.0.1", "[::1]"].includes(endpoint.hostname)))
    || !embedding.model.trim() || !Number.isSafeInteger(embedding.dimension)
    || embedding.dimension < 1 || embedding.dimension > 65_536) throw new Error("Invalid embedding identity.");
  const identitySha256 = createHash("sha256").update(JSON.stringify({
    protocol: embedding.protocol, endpoint: endpoint.href, model: embedding.model, dimension: embedding.dimension
  })).digest("hex");
  const directory = await lstat(root);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Unsafe local index directory.");
  const path = join(root, "embedding.json");
  const matches = async () => {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1_024) throw new Error("Invalid local index binding.");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (opened.size > 1_024 || opened.ino !== metadata.ino || opened.dev !== metadata.dev) throw new Error("Local index binding changed.");
      const text = await handle.readFile("utf8");
      if (Buffer.byteLength(text) > 1_024) throw new Error("Invalid local index binding.");
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new Error("Invalid local index binding."); }
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid local index binding.");
      const record = value as Record<string, unknown>;
      if (Object.keys(record).length !== 2 || record.version !== 1 || typeof record.identitySha256 !== "string"
        || !/^[a-f0-9]{64}$/u.test(record.identitySha256)) throw new Error("Invalid local index binding.");
      if (record.identitySha256 !== identitySha256) throw new Error("Embedding configuration changed; a separate index rebuild is required.");
      if (process.platform !== "win32") await handle.chmod(0o600);
    } finally { await handle.close(); }
  };
  try { await matches(); return; } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  try {
    const dataPath = join(root, "data");
    const data = await lstat(dataPath);
    if (!data.isDirectory() || data.isSymbolicLink() || (await readdir(dataPath)).length > 0) {
      throw new Error("Existing memory has no embedding binding; explicit index recovery is required.");
    }
  } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  const temporary = join(root, `.embedding-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify({ version: 1, identitySha256 }));
      await handle.sync();
    } finally { await handle.close(); }
    try { await link(temporary, path); } catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
    if (process.platform !== "win32") {
      const parent = await open(root, "r");
      try { await parent.sync(); } finally { await parent.close(); }
    }
    await matches();
  } finally { await unlink(temporary); }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
