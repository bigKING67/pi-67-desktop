import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { extract as createTarExtractor } from "tar-stream";
import { open as openZip, type Entry, type ZipFile } from "yauzl";
import type { PromptAttachmentWorkerTask } from "./prompt-attachment-worker-contract.js";

const MAX_RESULT_BYTES = 32 * 1024;
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
const MAX_ARCHIVE_RATIO = 100;

export async function listPromptAttachmentArchive(
  task: PromptAttachmentWorkerTask
): Promise<unknown[]> {
  if (isZip(task.attachment)) return listZip(task.path);
  if (isTar(task.attachment)) {
    const result = await inspectTar(task.path, task.attachment.mimeType, undefined);
    if (!Array.isArray(result)) throw new Error("Archive listing returned an invalid result.");
    return result;
  }
  throw new Error("Attachment is not a supported ZIP, TAR, or GZIP archive.");
}

export async function readPromptAttachmentArchiveEntry(
  task: PromptAttachmentWorkerTask,
  entry: string
): Promise<Buffer> {
  assertArchiveEntryName(entry);
  const bytes = isZip(task.attachment)
    ? await readZipEntry(task.path, entry)
    : await inspectTar(task.path, task.attachment.mimeType, entry);
  if (!bytes || Array.isArray(bytes)) throw new Error(`Archive entry was not found: ${entry}`);
  return bytes;
}

function listZip(path: string): Promise<unknown[]> {
  return withZip(path, (zip) => new Promise((resolve, reject) => {
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

function readZipEntry(path: string, target: string): Promise<Buffer> {
  return withZip(path, (zip) => new Promise((resolve, reject) => {
    let total = 0;
    zip.on("entry", (entry: Entry) => {
      try {
        validateZipEntry(entry);
        total += entry.uncompressedSize;
        if (total > MAX_ARCHIVE_UNCOMPRESSED_BYTES) throw new Error("Archive exceeds the uncompressed-size limit.");
        if (entry.fileName !== target) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            reject(error ?? new Error("Archive entry stream is unavailable."));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          stream.on("data", (chunk: Buffer) => {
            bytes += chunk.byteLength;
            if (bytes <= MAX_RESULT_BYTES) chunks.push(chunk);
          });
          stream.once("end", () => {
            zip.close();
            resolve(Buffer.concat(chunks).subarray(0, MAX_RESULT_BYTES));
          });
          stream.once("error", reject);
        });
      } catch (error) {
        zip.close();
        reject(error);
      }
    });
    zip.once("end", () => reject(new Error(`Archive entry was not found: ${target}`)));
    zip.once("error", reject);
    zip.readEntry();
  }));
}

function withZip<T>(path: string, operation: (zip: ZipFile) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    openZip(path, { lazyEntries: true, autoClose: false, decodeStrings: true }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error("ZIP archive could not be opened."));
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
  path: string,
  mimeType: string,
  target: string | undefined
): Promise<unknown[] | Buffer> {
  return new Promise((resolve, reject) => {
    const entries: unknown[] = [];
    let total = 0;
    let found: Buffer | undefined;
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
        const chunks: Buffer[] = [];
        let bytes = 0;
        stream.on("data", (chunk: Buffer) => {
          if (header.name !== target) return;
          bytes += chunk.byteLength;
          if (bytes <= MAX_RESULT_BYTES) chunks.push(chunk);
        });
        stream.once("end", () => {
          if (header.name === target) found = Buffer.concat(chunks).subarray(0, MAX_RESULT_BYTES);
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
          const archiveStat = await stat(path);
          if (archiveStat.size > 0 && total / archiveStat.size > MAX_ARCHIVE_RATIO) {
            throw new Error("Archive exceeds the 100:1 compression-ratio limit.");
          }
        }
        if (target === undefined) resolve(entries);
        else if (found) resolve(found);
        else reject(new Error(`Archive entry was not found: ${target}`));
      })().catch(reject);
    });
    extract.once("error", reject);
    const source = createReadStream(path);
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

function assertArchiveEntryName(value: string): void {
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").includes("..")) {
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
