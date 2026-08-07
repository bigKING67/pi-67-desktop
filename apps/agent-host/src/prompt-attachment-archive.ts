import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { extract as createTarExtractor } from "tar-stream";
import { fromBuffer as openZipBuffer, type Entry, type ZipFile } from "yauzl";
import type { PromptAttachmentWorkerTask } from "./prompt-attachment-worker-contract.js";

const MAX_RESULT_BYTES = 32 * 1024;
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
const MAX_ARCHIVE_RATIO = 100;
const MAX_ARCHIVE_ENTRY_NAME_CHARS = 4_096;
const MAX_ARCHIVE_PATH_DEPTH = 32;

export interface PromptAttachmentArchiveEntryResult {
  bytes: Buffer;
  truncated: boolean;
}

export async function listPromptAttachmentArchive(
  task: PromptAttachmentWorkerTask
): Promise<unknown[]> {
  const bytes = Buffer.from(task.bytes);
  if (isZip(task.attachment)) return listZip(bytes);
  if (isTar(task.attachment)) {
    const result = await inspectTar(bytes, task.attachment.mimeType, undefined);
    if (!Array.isArray(result)) throw new Error("Archive listing returned an invalid result.");
    return result;
  }
  throw new Error("Attachment is not a supported ZIP, TAR, or GZIP archive.");
}

export async function readPromptAttachmentArchiveEntry(
  task: PromptAttachmentWorkerTask,
  entry: string
): Promise<PromptAttachmentArchiveEntryResult> {
  assertArchiveEntryName(entry);
  const payload = Buffer.from(task.bytes);
  const bytes = isZip(task.attachment)
    ? await readZipEntry(payload, entry)
    : await inspectTar(payload, task.attachment.mimeType, entry);
  if (!bytes || Array.isArray(bytes)) throw new Error(`Archive entry was not found: ${entry}`);
  return bytes;
}

function listZip(bytes: Buffer): Promise<unknown[]> {
  return withZip(bytes, (zip) => new Promise((resolve, reject) => {
    const entries: unknown[] = [];
    let total = 0;
    zip.on("entry", (entry: Entry) => {
      try {
        validateZipEntry(entry);
        entries.push({ name: entry.fileName, byteLength: entry.uncompressedSize, directory: entry.fileName.endsWith("/") });
        total += entry.uncompressedSize;
        if (entries.length > MAX_ARCHIVE_ENTRIES || total > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
          throw new Error("Archive exceeds the bounded entry or uncompressed-size limit.");
        }
        zip.readEntry();
      } catch (error) {
        zip.close();
        reject(error);
      }
    });
    zip.once("end", () => resolve(entries));
    zip.once("error", reject);
    zip.readEntry();
  }));
}

function readZipEntry(bytes: Buffer, target: string): Promise<PromptAttachmentArchiveEntryResult> {
  return withZip(bytes, (zip) => new Promise((resolve, reject) => {
    let total = 0;
    let found: PromptAttachmentArchiveEntryResult | undefined;
    zip.on("entry", (entry: Entry) => {
      try {
        validateZipEntry(entry);
        total += entry.uncompressedSize;
        if (total > MAX_ARCHIVE_UNCOMPRESSED_BYTES) throw new Error("Archive exceeds the uncompressed-size limit.");
        if (entry.fileName !== target) {
          zip.readEntry();
          return;
        }
        if (found) throw new Error(`Archive contains duplicate entries named: ${target}`);
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            reject(error ?? new Error("Archive entry stream is unavailable."));
            return;
          }
          const collector = createBoundedCollector();
          stream.on("data", (chunk: Buffer) => collector.add(chunk));
          stream.once("end", () => {
            found = collector.result();
            zip.readEntry();
          });
          stream.once("error", reject);
        });
      } catch (error) {
        zip.close();
        reject(error);
      }
    });
    zip.once("end", () => {
      if (found) resolve(found);
      else reject(new Error(`Archive entry was not found: ${target}`));
    });
    zip.once("error", reject);
    zip.readEntry();
  }));
}

function withZip<T>(bytes: Buffer, operation: (zip: ZipFile) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    openZipBuffer(bytes, { lazyEntries: true, autoClose: false, decodeStrings: true }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error("ZIP archive could not be opened."));
        return;
      }
      if (zip.entryCount > MAX_ARCHIVE_ENTRIES) {
        zip.close();
        reject(new Error("Archive exceeds the bounded entry limit."));
        return;
      }
      operation(zip).then(resolve, reject).finally(() => zip.close());
    });
  });
}

function validateZipEntry(entry: Entry): void {
  assertArchiveEntryName(entry.fileName);
  if (entry.uncompressedSize < 0 || entry.compressedSize < 0) throw new Error("Archive entry has invalid sizes.");
  if (entry.compressedSize === 0 && entry.uncompressedSize > 0) throw new Error("Archive entry has an invalid compression ratio.");
  if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_ARCHIVE_RATIO) {
    throw new Error("Archive entry exceeds the 100:1 compression-ratio limit.");
  }
}

function inspectTar(
  bytes: Buffer,
  mimeType: string,
  target: string | undefined
): Promise<unknown[] | PromptAttachmentArchiveEntryResult> {
  return new Promise((resolve, reject) => {
    const entries: unknown[] = [];
    let total = 0;
    let found: PromptAttachmentArchiveEntryResult | undefined;
    const extract = createTarExtractor();
    extract.on("entry", (header, stream, next) => {
      try {
        assertArchiveEntryName(header.name);
        const size = header.size ?? 0;
        if (!Number.isSafeInteger(size) || size < 0) throw new Error("Archive entry has an invalid size.");
        total += size;
        if (entries.length >= MAX_ARCHIVE_ENTRIES || total > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
          throw new Error("Archive exceeds the bounded entry or uncompressed-size limit.");
        }
        entries.push({ name: header.name, byteLength: size, type: header.type });
        const collector = header.name === target ? createBoundedCollector() : undefined;
        stream.on("data", (chunk: Buffer) => {
          collector?.add(chunk);
        });
        stream.once("end", () => {
          if (collector && !found) found = collector.result();
          next();
        });
        stream.once("error", reject);
        stream.resume();
      } catch (error) {
        stream.resume();
        reject(error);
      }
    });
    extract.once("finish", () => {
      void (async () => {
        if (mimeType === "application/gzip") {
          if (bytes.byteLength > 0 && total / bytes.byteLength > MAX_ARCHIVE_RATIO) {
            throw new Error("Archive exceeds the 100:1 compression-ratio limit.");
          }
        }
        if (target === undefined) resolve(entries);
        else if (found) resolve(found);
        else reject(new Error(`Archive entry was not found: ${target}`));
      })().catch(reject);
    });
    extract.once("error", reject);
    const source = Readable.from([bytes]);
    source.once("error", reject);
    if (mimeType === "application/gzip") {
      const gunzip = createGunzip();
      gunzip.once("error", reject);
      source.pipe(gunzip).pipe(extract);
    } else {
      source.pipe(extract);
    }
  });
}

function createBoundedCollector(): {
  add(chunk: Buffer): void;
  result(): PromptAttachmentArchiveEntryResult;
} {
  const chunks: Buffer[] = [];
  let collectedBytes = 0;
  let truncated = false;
  return {
    add(chunk) {
      const remaining = MAX_RESULT_BYTES - collectedBytes;
      if (remaining > 0) {
        const retained = chunk.subarray(0, remaining);
        chunks.push(retained);
        collectedBytes += retained.byteLength;
      }
      if (chunk.byteLength > remaining) truncated = true;
    },
    result() {
      return { bytes: Buffer.concat(chunks, collectedBytes), truncated };
    }
  };
}

function assertArchiveEntryName(value: string): void {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (normalized.length === 0 || normalized.length > MAX_ARCHIVE_ENTRY_NAME_CHARS
    || normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)
    || normalized.includes("\0") || segments.length > MAX_ARCHIVE_PATH_DEPTH
    || segments.includes(".") || segments.includes("..")) {
    throw new Error("Archive contains an unsafe entry path.");
  }
}

function isZip(attachment: PromptAttachmentWorkerTask["attachment"]): boolean {
  return attachment.mimeType === "application/zip"
    || attachment.mimeType === "application/x-zip-compressed"
    || attachment.mimeType === "application/epub+zip"
    || attachment.mimeType.includes("officedocument")
    || /\.(?:zip|docx|xlsx|pptx|epub)$/iu.test(attachment.name);
}

function isTar(attachment: PromptAttachmentWorkerTask["attachment"]): boolean {
  return attachment.mimeType === "application/x-tar"
    || attachment.mimeType === "application/gzip"
    || /\.(?:tar|tgz|gz)$/iu.test(attachment.name);
}
