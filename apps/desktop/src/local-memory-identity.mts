import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const profilePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Non-secret identity, independent of hosted login; never silently reset it. */
export async function loadLocalMemoryIdentity(root: string): Promise<string> {
  if (!isAbsolute(root)) throw new Error("Local memory requires an absolute data root.");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await lstat(root);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Unsafe local memory directory.");
  if (process.platform !== "win32") await chmod(root, 0o700);
  const path = join(root, "profile.json");
  try { return await readIdentity(path); }
  catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  try {
    const data = await lstat(join(root, "data"));
    if (data.isSymbolicLink() || !data.isDirectory() || (await readdir(join(root, "data"))).length > 0) {
      throw new Error("Local memory data exists without its profile identity; recovery is required.");
    }
  } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  const temporary = join(root, `.profile-${randomUUID()}.tmp`);
  const localProfileId = randomUUID();
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify({ version: 1, localProfileId }));
      await handle.sync();
    } finally { await handle.close(); }
    try { await link(temporary, path); }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
    if (process.platform !== "win32") {
      const parent = await open(root, "r");
      try { await parent.sync(); } finally { await parent.close(); }
    }
    return await readIdentity(path);
  } finally { await unlink(temporary); }
}

/** Team preparation reads an established profile; it never creates or repairs it. */
export async function readExistingLocalMemoryIdentity(root: string): Promise<string> {
  if (!isAbsolute(root)) throw new Error("Local memory requires an absolute data root.");
  return readIdentity(join(root, "profile.json"), false);
}

async function readIdentity(path: string, repairPermissions = true): Promise<string> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1_024) {
    throw new Error("Invalid local memory profile identity.");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadataAfterOpen = await handle.stat();
    if (metadataAfterOpen.size > 1_024 || metadataAfterOpen.ino !== metadata.ino || metadataAfterOpen.dev !== metadata.dev) {
      throw new Error("Local memory profile identity changed while opening.");
    }
    const text = await handle.readFile("utf8");
    if (Buffer.byteLength(text) > 1_024) throw new Error("Invalid local memory profile identity.");
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid local memory profile identity.");
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || record.version !== 1 || typeof record.localProfileId !== "string"
      || !profilePattern.test(record.localProfileId)) throw new Error("Invalid local memory profile identity.");
    if (!repairPermissions) {
      const after = await handle.stat(), current = await lstat(path);
      if (after.size !== metadataAfterOpen.size || after.mtimeMs !== metadataAfterOpen.mtimeMs || after.ctimeMs !== metadataAfterOpen.ctimeMs
        || current.isSymbolicLink() || current.ino !== after.ino || current.dev !== after.dev
        || process.platform !== "win32" && (after.uid !== process.getuid?.() || (after.mode & 0o077) !== 0)) {
        throw new Error("Unsafe or changed local memory profile identity.");
      }
    } else if (process.platform !== "win32") await handle.chmod(0o600);
    return record.localProfileId;
  } finally { await handle.close(); }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
