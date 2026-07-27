import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { lstat, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { MAX_SESSION_IMPORT_LINE_BYTES } from "./session-import.js";

const SESSION_JSONL_READ_CHUNK_BYTES = 256 * 1024;
const SESSION_JSONL_MAX_DRAIN_BYTES = 4 * 1024 * 1024;

export type SessionJsonlChangeReason =
  | "appended"
  | "truncated"
  | "replaced"
  | "unavailable"
  | "invalid";

interface SessionJsonlFileIdentity {
  device: bigint;
  inode: bigint;
  birthtimeNs: bigint;
}

export interface SessionJsonlTailCursor {
  readonly path: string;
  readonly byteOffset: number;
  readonly fileIdentity?: SessionJsonlFileIdentity;
  readonly mtimeNs: bigint;
  readonly pendingLine: Uint8Array;
}

export interface SessionJsonlTailLimits {
  readChunkBytes?: number;
  maxBytesPerDrain?: number;
  maxLineBytes?: number;
}

interface SessionJsonlTailAppend {
  kind: "appended";
  cursor: SessionJsonlTailCursor;
  records: ReadonlyArray<Record<string, unknown>>;
  physicalLineCount: number;
  ignoredLineCount: number;
  appendedBytes: number;
  more: boolean;
}

interface SessionJsonlTailUnchanged {
  kind: "unchanged";
  cursor: SessionJsonlTailCursor;
}

interface SessionJsonlTailConflict {
  kind: "conflict";
  reason: Exclude<SessionJsonlChangeReason, "appended">;
  recoverable: boolean;
}

export type SessionJsonlTailDrain =
  | SessionJsonlTailAppend
  | SessionJsonlTailUnchanged
  | SessionJsonlTailConflict;

interface OpenedSessionFile {
  handle: FileHandle;
  stats: BigIntStats;
}

interface ResolvedTailLimits {
  readChunkBytes: number;
  maxBytesPerDrain: number;
  maxLineBytes: number;
}

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

export async function createSessionJsonlTailCursor(
  path: string,
  limits: SessionJsonlTailLimits = {}
): Promise<SessionJsonlTailCursor> {
  const resolvedPath = resolve(path);
  const opened = await openVerifiedSessionFile(resolvedPath);
  if (opened === undefined) {
    return {
      path: resolvedPath,
      byteOffset: 0,
      mtimeNs: 0n,
      pendingLine: new Uint8Array()
    };
  }

  const resolvedLimits = resolveLimits(limits);
  try {
    const size = safeFileSize(opened.stats.size);
    const pendingLine = await readTrailingPhysicalLine(opened.handle, size, resolvedLimits.maxLineBytes);
    return {
      path: resolvedPath,
      byteOffset: size,
      fileIdentity: fileIdentity(opened.stats),
      mtimeNs: opened.stats.mtimeNs,
      pendingLine
    };
  } finally {
    await opened.handle.close();
  }
}

export async function drainSessionJsonlTail(
  cursor: SessionJsonlTailCursor,
  limits: SessionJsonlTailLimits = {}
): Promise<SessionJsonlTailDrain> {
  const resolvedLimits = resolveLimits(limits);
  const opened = await openVerifiedSessionFile(cursor.path).catch((error: unknown) => (
    conflictFromOpenError(error)
  ));
  if (isTailConflict(opened)) return opened;
  if (opened === undefined) {
    return cursor.fileIdentity === undefined
      ? { kind: "unchanged", cursor }
      : { kind: "conflict", reason: "unavailable", recoverable: true };
  }

  try {
    const currentIdentity = fileIdentity(opened.stats);
    if (cursor.fileIdentity !== undefined && !sameFileIdentity(cursor.fileIdentity, currentIdentity)) {
      return { kind: "conflict", reason: "replaced", recoverable: true };
    }

    const initialSize = safeFileSize(opened.stats.size);
    if (initialSize < cursor.byteOffset) {
      return { kind: "conflict", reason: "truncated", recoverable: true };
    }
    if (initialSize === cursor.byteOffset) {
      if (cursor.fileIdentity !== undefined && opened.stats.mtimeNs !== cursor.mtimeNs) {
        return { kind: "conflict", reason: "replaced", recoverable: true };
      }
      return { kind: "unchanged", cursor };
    }

    const readEnd = Math.min(initialSize, cursor.byteOffset + resolvedLimits.maxBytesPerDrain);
    const appended = await readAppendedBytes(
      opened.handle,
      cursor.byteOffset,
      readEnd,
      resolvedLimits.readChunkBytes
    );
    const parsed = parsePhysicalLines(cursor.pendingLine, appended.bytes, resolvedLimits.maxLineBytes);
    if (parsed.kind === "conflict") return parsed;

    const handleStats = await opened.handle.stat({ bigint: true });
    if (!sameFileIdentity(currentIdentity, fileIdentity(handleStats))) {
      return { kind: "conflict", reason: "replaced", recoverable: true };
    }
    if (safeFileSize(handleStats.size) < appended.byteOffset) {
      return { kind: "conflict", reason: "truncated", recoverable: true };
    }

    const pathStats = await inspectSessionPath(cursor.path);
    if (pathStats === undefined) {
      return { kind: "conflict", reason: "unavailable", recoverable: true };
    }
    if (!sameFileIdentity(currentIdentity, fileIdentity(pathStats))) {
      return { kind: "conflict", reason: "replaced", recoverable: true };
    }

    return {
      kind: "appended",
      cursor: {
        path: cursor.path,
        byteOffset: appended.byteOffset,
        fileIdentity: currentIdentity,
        mtimeNs: pathStats.mtimeNs,
        pendingLine: parsed.pendingLine
      },
      records: parsed.records,
      physicalLineCount: parsed.physicalLineCount,
      ignoredLineCount: parsed.ignoredLineCount,
      appendedBytes: appended.bytes.byteLength,
      more: safeFileSize(pathStats.size) > appended.byteOffset
    };
  } catch (error) {
    return conflictFromReadError(error);
  } finally {
    await opened.handle.close();
  }
}

async function openVerifiedSessionFile(path: string): Promise<OpenedSessionFile | undefined> {
  const pathStats = await inspectSessionPath(path);
  if (pathStats === undefined) return undefined;
  const handle = await open(path, "r");
  try {
    const handleStats = await handle.stat({ bigint: true });
    if (!sameFileIdentity(fileIdentity(pathStats), fileIdentity(handleStats))) {
      throw new SessionJsonlTailError("replaced", true);
    }
    return { handle, stats: handleStats };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function inspectSessionPath(path: string): Promise<BigIntStats | undefined> {
  let stats: BigIntStats;
  try {
    stats = await lstat(path, { bigint: true });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw new SessionJsonlTailError("unavailable", true, error);
  }
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1n) {
    throw new SessionJsonlTailError("invalid", false);
  }
  const canonicalPath = await realpath(path).catch((error: unknown) => {
    throw new SessionJsonlTailError("unavailable", true, error);
  });
  if (normalizePath(canonicalPath) !== normalizePath(resolve(path))) {
    throw new SessionJsonlTailError("invalid", false);
  }
  return stats;
}

async function readTrailingPhysicalLine(
  handle: FileHandle,
  size: number,
  maxLineBytes: number
): Promise<Uint8Array> {
  if (size === 0) return new Uint8Array();
  const lastByte = Buffer.allocUnsafe(1);
  const lastRead = await handle.read(lastByte, 0, 1, size - 1);
  if (lastRead.bytesRead !== 1) throw new SessionJsonlTailError("unavailable", true);
  if (lastByte[0] === 0x0a) return new Uint8Array();

  const length = Math.min(size, maxLineBytes + 1);
  const tail = Buffer.allocUnsafe(length);
  const read = await handle.read(tail, 0, length, size - length);
  if (read.bytesRead !== length) throw new SessionJsonlTailError("unavailable", true);
  const newline = tail.lastIndexOf(0x0a);
  const pendingLine = tail.subarray(newline + 1);
  if (pendingLine.byteLength > maxLineBytes || (newline === -1 && size > maxLineBytes)) {
    throw new SessionJsonlTailError("invalid", false);
  }
  return Buffer.from(pendingLine);
}

async function readAppendedBytes(
  handle: FileHandle,
  start: number,
  end: number,
  chunkBytes: number
): Promise<{ bytes: Uint8Array; byteOffset: number }> {
  const chunks: Buffer[] = [];
  let byteOffset = start;
  while (byteOffset < end) {
    const length = Math.min(chunkBytes, end - byteOffset);
    const chunk = Buffer.allocUnsafe(length);
    const read = await handle.read(chunk, 0, length, byteOffset);
    if (read.bytesRead === 0) throw new SessionJsonlTailError("unavailable", true);
    chunks.push(read.bytesRead === length ? chunk : chunk.subarray(0, read.bytesRead));
    byteOffset += read.bytesRead;
  }
  return { bytes: Buffer.concat(chunks), byteOffset };
}

function parsePhysicalLines(
  pendingLine: Uint8Array,
  appendedBytes: Uint8Array,
  maxLineBytes: number
): {
  kind: "parsed";
  records: Array<Record<string, unknown>>;
  physicalLineCount: number;
  ignoredLineCount: number;
  pendingLine: Uint8Array;
} | SessionJsonlTailConflict {
  const combined = Buffer.concat([Buffer.from(pendingLine), Buffer.from(appendedBytes)]);
  const records: Array<Record<string, unknown>> = [];
  let physicalLineCount = 0;
  let ignoredLineCount = 0;
  let lineStart = 0;

  for (let index = 0; index < combined.byteLength; index += 1) {
    if (combined[index] !== 0x0a) continue;
    const physicalLine = combined.subarray(lineStart, index);
    if (physicalLine.byteLength > maxLineBytes) {
      return { kind: "conflict", reason: "invalid", recoverable: false };
    }
    physicalLineCount += 1;
    const parsed = parseJsonlRecord(physicalLine);
    if (parsed === undefined) ignoredLineCount += 1;
    else if (parsed === null) return { kind: "conflict", reason: "invalid", recoverable: false };
    else records.push(parsed);
    lineStart = index + 1;
  }

  const nextPending = combined.subarray(lineStart);
  if (nextPending.byteLength > maxLineBytes) {
    return { kind: "conflict", reason: "invalid", recoverable: false };
  }
  return {
    kind: "parsed",
    records,
    physicalLineCount,
    ignoredLineCount,
    pendingLine: Buffer.from(nextPending)
  };
}

function parseJsonlRecord(lineBytes: Uint8Array): Record<string, unknown> | null | undefined {
  const withoutCarriageReturn = lineBytes.at(-1) === 0x0d
    ? lineBytes.subarray(0, lineBytes.byteLength - 1)
    : lineBytes;
  let line: string;
  try {
    line = fatalUtf8Decoder.decode(withoutCarriageReturn);
  } catch {
    return null;
  }
  if (!line.trim()) return undefined;
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) && typeof value.type === "string" ? value : null;
  } catch {
    return null;
  }
}

function resolveLimits(limits: SessionJsonlTailLimits): ResolvedTailLimits {
  const resolved = {
    readChunkBytes: limits.readChunkBytes ?? SESSION_JSONL_READ_CHUNK_BYTES,
    maxBytesPerDrain: limits.maxBytesPerDrain ?? SESSION_JSONL_MAX_DRAIN_BYTES,
    maxLineBytes: limits.maxLineBytes ?? MAX_SESSION_IMPORT_LINE_BYTES
  };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  return resolved;
}

function safeFileSize(size: bigint): number {
  if (size < 0n || size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new SessionJsonlTailError("invalid", false);
  }
  return Number(size);
}

function fileIdentity(stats: BigIntStats): SessionJsonlFileIdentity {
  return { device: stats.dev, inode: stats.ino, birthtimeNs: stats.birthtimeNs };
}

function sameFileIdentity(left: SessionJsonlFileIdentity, right: SessionJsonlFileIdentity): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.birthtimeNs === right.birthtimeNs;
}

function conflictFromOpenError(error: unknown): SessionJsonlTailConflict {
  if (error instanceof SessionJsonlTailError) {
    return { kind: "conflict", reason: error.reason, recoverable: error.recoverable };
  }
  return { kind: "conflict", reason: "unavailable", recoverable: true };
}

function conflictFromReadError(error: unknown): SessionJsonlTailConflict {
  return conflictFromOpenError(error);
}

function isTailConflict(value: unknown): value is SessionJsonlTailConflict {
  return isRecord(value) && value.kind === "conflict";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

export class SessionJsonlTailError extends Error {
  constructor(
    readonly reason: Exclude<SessionJsonlChangeReason, "appended">,
    readonly recoverable: boolean,
    cause?: unknown
  ) {
    super(`Pi session JSONL tail is ${reason}.`, cause === undefined ? undefined : { cause });
    this.name = "SessionJsonlTailError";
  }
}
