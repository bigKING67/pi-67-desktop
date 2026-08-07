import { createHash } from "node:crypto";
import {
  constants,
  createReadStream,
  createWriteStream,
  type BigIntStats
} from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { PreparedPromptAttachment } from "@pi67/pi-runtime";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_PROMPT_ATTACHMENT_BYTES,
  MAX_PROMPT_ATTACHMENT_NAME_CHARS
} from "@pi67/protocol";

export interface StagedManifest extends PreparedPromptAttachment {
  version: 1;
  sha256: string;
  stagedAt: number;
}

const MAX_STAGED_MANIFEST_BYTES = 16 * 1024;

export async function validateStagedAttachment(
  root: string,
  directory: string,
  expectedId: string
): Promise<StagedManifest> {
  const manifest = await readStagedManifest(root, directory, expectedId);
  const path = join(directory, "payload.bin");
  const opened = await openVerifiedPayload(path, manifest);
  try {
    const hash = createHash("sha256");
    await new Promise<void>((resolveHash, reject) => {
      const stream = createReadStream(path, { fd: opened.handle.fd, autoClose: false });
      stream.on("data", (chunk) => hash.update(chunk));
      stream.once("end", resolveHash);
      stream.once("error", reject);
    });
    await assertPayloadSnapshot(opened.openedState, opened.handle);
    if (hash.digest("hex") !== manifest.sha256) {
      throw new Error("Staged attachment integrity check failed.");
    }
    return manifest;
  } finally {
    await opened.handle.close();
  }
}

export async function readVerifiedStagedAttachmentBytes(
  root: string,
  directory: string,
  expectedId: string
): Promise<{ manifest: StagedManifest; bytes: Buffer }> {
  const manifest = await readStagedManifest(root, directory, expectedId);
  const path = join(directory, "payload.bin");
  const opened = await openVerifiedPayload(path, manifest);
  try {
    const bytes = await opened.handle.readFile();
    await assertPayloadSnapshot(opened.openedState, opened.handle);
    if (bytes.byteLength !== manifest.byteLength
      || createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) {
      throw new Error("Staged attachment integrity check failed.");
    }
    return { manifest, bytes };
  } finally {
    await opened.handle.close();
  }
}

export async function copyVerifiedStagedAttachment(
  sourceRoot: string,
  sourceDirectory: string,
  expectedId: string,
  destinationDirectory: string
): Promise<StagedManifest> {
  const manifest = await readStagedManifest(sourceRoot, sourceDirectory, expectedId);
  const sourcePath = join(sourceDirectory, "payload.bin");
  const opened = await openVerifiedPayload(sourcePath, manifest);
  await mkdir(destinationDirectory, { mode: 0o700 });
  try {
    const copied = await copyOpenedPayload(
      sourcePath,
      opened.handle.fd,
      join(destinationDirectory, "payload.bin")
    );
    await assertPayloadSnapshot(opened.openedState, opened.handle);
    if (copied.byteLength !== manifest.byteLength || copied.sha256 !== manifest.sha256) {
      throw new Error("Staged attachment integrity check failed.");
    }
    await writePrivateTextFile(
      join(destinationDirectory, "manifest.json"),
      `${JSON.stringify(manifest)}\n`
    );
    return manifest;
  } finally {
    await opened.handle.close();
  }
}

export async function writePrivateTextFile(path: string, value: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(value, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function publicAttachment(manifest: StagedManifest): PreparedPromptAttachment {
  return {
    id: manifest.id,
    name: manifest.name,
    mimeType: manifest.mimeType,
    byteLength: manifest.byteLength,
    kind: manifest.kind
  };
}

export function assertSameAttachment(
  expected: PreparedPromptAttachment,
  actual: PreparedPromptAttachment
): void {
  if (expected.id !== actual.id || expected.name !== actual.name
    || expected.mimeType !== actual.mimeType || expected.byteLength !== actual.byteLength
    || expected.kind !== actual.kind) {
    throw new Error("Claimed attachment metadata does not match its item manifest.");
  }
}

export function assertOpaqueId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new Error("Prompt attachment id is invalid.");
  }
  return value;
}

export function toTransferableArrayBuffer(bytes: Buffer): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
  return Uint8Array.from(bytes).buffer;
}

async function readStagedManifest(
  root: string,
  directory: string,
  expectedId: string
): Promise<StagedManifest> {
  const directoryState = await lstat(directory);
  if (directoryState.isSymbolicLink() || !directoryState.isDirectory()) {
    throw new Error("Staged attachment directory is invalid.");
  }
  const [canonicalDirectory, canonicalRoot] = await Promise.all([
    realpath(directory),
    realpath(root)
  ]);
  if (canonicalDirectory !== join(canonicalRoot, expectedId)) {
    throw new Error("Staged attachment path is not canonical.");
  }
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length !== 2
    || !entries.some((entry) => entry.name === "manifest.json" && entry.isFile())
    || !entries.some((entry) => entry.name === "payload.bin" && entry.isFile())) {
    throw new Error("Staged attachment directory contents are invalid.");
  }
  const manifest = parseStagedManifest(await readPrivateTextFile(
    join(directory, "manifest.json"),
    MAX_STAGED_MANIFEST_BYTES
  ));
  if (manifest.id !== expectedId) {
    throw new Error("Staged attachment identity does not match its directory.");
  }
  return manifest;
}

async function openVerifiedPayload(path: string, manifest: StagedManifest): Promise<{
  handle: Awaited<ReturnType<typeof open>>;
  openedState: BigIntStats;
}> {
  const pathState = await lstat(path, { bigint: true });
  if (pathState.isSymbolicLink() || !pathState.isFile()) {
    throw new Error("Staged attachment payload is invalid.");
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedState = await handle.stat({ bigint: true });
    if (!openedState.isFile() || !samePhysicalFile(pathState, openedState)
      || openedState.size !== BigInt(manifest.byteLength)) {
      throw new Error("Staged attachment payload changed before validation.");
    }
    return { handle, openedState };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function copyOpenedPayload(
  sourcePath: string,
  sourceFd: number,
  destinationPath: string
): Promise<{ byteLength: number; sha256: string }> {
  const destination = await open(
    destinationPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600
  );
  const hash = createHash("sha256");
  let byteLength = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteLength += chunk.byteLength;
      if (byteLength > MAX_PROMPT_ATTACHMENT_BYTES) {
        callback(new Error("Attachment exceeds the 100 MiB per-file limit."));
        return;
      }
      hash.update(chunk);
      callback(undefined, chunk);
    }
  });
  try {
    await pipeline(
      createReadStream(sourcePath, { fd: sourceFd, autoClose: false }),
      meter,
      createWriteStream(destinationPath, { fd: destination.fd, autoClose: false })
    );
    await destination.sync();
    return { byteLength, sha256: hash.digest("hex") };
  } finally {
    await destination.close();
  }
}

export async function readPrivateTextFile(path: string, maximumBytes: number): Promise<string> {
  const pathState = await lstat(path, { bigint: true });
  if (pathState.isSymbolicLink() || !pathState.isFile()
    || pathState.size > BigInt(maximumBytes)) {
    throw new Error("Prompt attachment manifest is invalid.");
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedState = await handle.stat({ bigint: true });
    if (!openedState.isFile() || !samePhysicalFile(pathState, openedState)) {
      throw new Error("Prompt attachment manifest changed before reading.");
    }
    const value = await handle.readFile({ encoding: "utf8" });
    const completedState = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(openedState, completedState)
      || Buffer.byteLength(value, "utf8") > maximumBytes) {
      throw new Error("Prompt attachment manifest changed while reading.");
    }
    return value;
  } finally {
    await handle.close();
  }
}

async function assertPayloadSnapshot(
  openedState: BigIntStats,
  handle: Awaited<ReturnType<typeof open>>
): Promise<void> {
  const completedState = await handle.stat({ bigint: true });
  if (!sameFileSnapshot(openedState, completedState)) {
    throw new Error("Staged attachment payload changed during validation.");
  }
}

function parseStagedManifest(value: string): StagedManifest {
  const record = asRecord(JSON.parse(value) as unknown);
  assertExactKeys(record, [
    "version", "id", "name", "mimeType", "byteLength", "kind", "sha256", "stagedAt"
  ]);
  const attachment = parsePreparedAttachmentRecord(record);
  if (record.version !== 1 || typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(record.sha256)
    || !Number.isSafeInteger(record.stagedAt) || Number(record.stagedAt) < 0) {
    throw new Error("Staged attachment manifest is invalid.");
  }
  return {
    version: 1,
    ...attachment,
    sha256: record.sha256,
    stagedAt: Number(record.stagedAt)
  };
}

export function parsePreparedAttachment(value: unknown): PreparedPromptAttachment {
  const record = asRecord(value);
  assertExactKeys(record, ["id", "name", "mimeType", "byteLength", "kind"]);
  return parsePreparedAttachmentRecord(record);
}

function parsePreparedAttachmentRecord(record: Record<string, unknown>): PreparedPromptAttachment {
  const kind = record.kind;
  if (typeof record.name !== "string" || record.name.length === 0
    || record.name.length > MAX_PROMPT_ATTACHMENT_NAME_CHARS) {
    throw new Error("Prompt attachment name is invalid.");
  }
  if (typeof record.mimeType !== "string" || record.mimeType.length > 128) {
    throw new Error("Prompt attachment MIME type is invalid.");
  }
  if (!Number.isSafeInteger(record.byteLength) || Number(record.byteLength) < 0
    || Number(record.byteLength) > MAX_PROMPT_ATTACHMENT_BYTES) {
    throw new Error("Prompt attachment byte length is invalid.");
  }
  if (!isAttachmentKind(kind)) throw new Error("Prompt attachment kind is invalid.");
  if (kind === "image" && !ALLOWED_IMAGE_MIME_TYPES.some((mimeType) => mimeType === record.mimeType)) {
    throw new Error("Prompt attachment image MIME type is invalid.");
  }
  return {
    id: assertOpaqueId(record.id),
    name: record.name,
    mimeType: record.mimeType,
    byteLength: Number(record.byteLength),
    kind
  };
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(record);
  if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(record, key))) {
    throw new Error("Prompt attachment manifest is invalid.");
  }
}

function isAttachmentKind(value: unknown): value is PreparedPromptAttachment["kind"] {
  return value === "image" || value === "document" || value === "archive"
    || value === "audio" || value === "video" || value === "file";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function samePhysicalFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeNs === right.birthtimeNs;
}

function sameFileSnapshot(left: BigIntStats, right: BigIntStats): boolean {
  return samePhysicalFile(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}
