import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";

// Project files are written once and never replaced. Shared by revision
// publication, asset imports, masks, candidates and the bound font.
export function fail(message: string): never { throw new Error(message); }
export const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
export const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");

async function digest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export interface WriteOnceContent { bytes?: Buffer; source?: string }
export interface WriteOnceOptions { expected?: string; mismatch?: string; conflict?: string }

// Places `bytes` (or a copy of `source`) at `target` without ever replacing a
// file: the content goes to a temporary file in the target directory, its
// digest is checked against `expected` (if given) before it is published, then
// it is hard-linked into place, so readers see no file or the complete file.
// When the target already exists: `conflict` set fails with that message;
// otherwise the existing file is reused (content addressing: same name, same
// bytes). Either way the published file's digest is checked again. Returns
// true when this call created the file.
export async function writeOnce(target: string, content: WriteOnceContent, options: WriteOnceOptions = {}): Promise<boolean> {
  const { expected, mismatch = "Content changed while writing", conflict } = options;
  const directory = path.dirname(target);
  const temp = path.join(directory, `.pending-${randomUUID()}`);
  if (content.source !== undefined) await fs.copyFile(content.source, temp, fs.constants.COPYFILE_EXCL);
  else if (content.bytes !== undefined) await fs.writeFile(temp, content.bytes, { flag: "wx" });
  else fail("writeOnce needs bytes or a source file");
  let created = false;
  try {
    // Durable before visible: a crash must not publish a linked but empty file.
    await syncPath(temp, "r+");
    if (expected && await digest(temp) !== expected) fail(mismatch);
    await fs.link(temp, target);
    created = true;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    if (conflict) fail(conflict);
  } finally { await fs.unlink(temp); }
  if (created) await syncPath(directory, "r").catch((error: unknown) => {
    // Some platforms (Windows) cannot open or fsync a directory handle.
    if (!["EISDIR", "EPERM", "EINVAL", "EACCES"].includes(errorCode(error) ?? "")) throw error;
  });
  if (expected && await digest(target) !== expected) fail(mismatch);
  return created;
}

async function syncPath(file: string, flags: string): Promise<void> {
  const handle = await fs.open(file, flags);
  try { await handle.sync(); } finally { await handle.close(); }
}

export const encodeJson = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
