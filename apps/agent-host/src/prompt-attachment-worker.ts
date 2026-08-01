import { createRequire } from "node:module";
import { copyFile, mkdir, open, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parentPort } from "node:worker_threads";
import { detect } from "chardet";
import { fileTypeFromFile } from "file-type";
import mediaInfoFactory from "mediainfo.js";
import { parseFile as parseAudioFile } from "music-metadata";
import { OfficeParser } from "officeparser";
import { createWorker as createOcrWorker } from "tesseract.js";
import {
  listPromptAttachmentArchive,
  readPromptAttachmentArchiveEntry
} from "./prompt-attachment-archive.js";
import type {
  PromptAttachmentWorkerResponse,
  PromptAttachmentWorkerTask
} from "./prompt-attachment-worker-contract.js";

const MAX_RESULT_BYTES = 32 * 1024;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;

if (!parentPort && process.env.NODE_ENV !== "test") {
  throw new Error("Prompt attachment worker requires a parent port.");
}

parentPort?.on("message", (task: PromptAttachmentWorkerTask) => {
  void executePromptAttachmentTask(task).then(({ text, truncated }) => {
    const response: PromptAttachmentWorkerResponse = { id: task.id, ok: true, text, truncated };
    parentPort!.postMessage(response);
  }).catch((error: unknown) => {
    const response: PromptAttachmentWorkerResponse = {
      id: task.id,
      ok: false,
      error: boundedError(error)
    };
    parentPort!.postMessage(response);
  });
});

export async function executePromptAttachmentTask(
  task: PromptAttachmentWorkerTask
): Promise<{ text: string; truncated: boolean }> {
  switch (task.operation) {
    case "metadata":
      return boundText(JSON.stringify(await metadata(task), null, 2));
    case "read_text":
      return boundText(await readText(task));
    case "search":
      return boundText(await searchText(task));
    case "strings":
      return boundText(await binaryStrings(task.path));
    case "read_bytes":
      return boundText(await readBytes(task));
    case "list_archive":
      return boundText(JSON.stringify(await listArchive(task), null, 2));
    case "read_archive_entry":
      return boundText(await readArchiveEntry(task));
    default:
      throw new Error(`Unsupported attachment worker operation: ${task.operation}`);
  }
}

async function metadata(task: PromptAttachmentWorkerTask): Promise<Record<string, unknown>> {
  const detected = await fileTypeFromFile(task.path).catch(() => undefined);
  const base: Record<string, unknown> = {
    id: task.attachment.id,
    name: task.attachment.name,
    declaredMimeType: task.attachment.mimeType,
    detectedMimeType: detected?.mime,
    detectedExtension: detected?.ext,
    byteLength: task.attachment.byteLength,
    kind: task.attachment.kind
  };
  if (task.attachment.kind === "audio") {
    const parsed = await parseAudioFile(task.path, { duration: true, skipCovers: true });
    base.media = {
      format: parsed.format.container,
      codec: parsed.format.codec,
      durationSeconds: parsed.format.duration,
      bitrate: parsed.format.bitrate,
      sampleRate: parsed.format.sampleRate,
      channels: parsed.format.numberOfChannels
    };
  } else if (task.attachment.kind === "video") {
    base.media = await videoMetadata(task.path, task.attachment.byteLength);
  }
  return base;
}

async function videoMetadata(path: string, byteLength: number): Promise<unknown> {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve("mediainfo.js/MediaInfoModule.wasm");
  const mediaInfo = await mediaInfoFactory({
    format: "object",
    coverData: false,
    full: false,
    locateFile: () => wasmPath
  });
  const handle = await open(path, "r");
  try {
    return await mediaInfo.analyzeData(byteLength, async (size, offset) => {
      const buffer = Buffer.alloc(Math.min(size, Math.max(0, byteLength - offset)));
      const result = await handle.read(buffer, 0, buffer.byteLength, offset);
      return buffer.subarray(0, result.bytesRead);
    });
  } finally {
    mediaInfo.close();
    await handle.close();
  }
}

async function readText(task: PromptAttachmentWorkerTask): Promise<string> {
  if (task.attachment.kind === "image") return ocrImage(task);
  if (isOfficeDocument(task.attachment.name, task.attachment.mimeType)) return extractOfficeText(task);
  const bytes = await readBoundedFile(task.path, MAX_CACHE_BYTES);
  return decodeText(bytes);
}

async function extractOfficeText(task: PromptAttachmentWorkerTask): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 115_000);
  try {
    let ast = await OfficeParser.parseOffice(task.path, {
      abortSignal: controller.signal,
      decompressionLimits: {
        maxZipEntries: MAX_ARCHIVE_ENTRIES,
        maxUncompressedBytes: MAX_ARCHIVE_UNCOMPRESSED_BYTES,
        maxTableCells: 250_000
      }
    });
    let text = String((await ast.to("text")).value);
    const pages = typeof ast.metadata?.pages === "number" ? ast.metadata.pages : undefined;
    if (task.attachment.mimeType === "application/pdf" && text.trim().length < 32) {
      if (pages !== undefined && pages > 50) {
        return `${text}\n[OCR skipped: PDF has ${pages} pages; the per-attachment limit is 50.]`;
      }
      const langPath = await prepareOcrData(task.ocrDataRoot);
      ast = await OfficeParser.parseOffice(task.path, {
        abortSignal: controller.signal,
        extractAttachments: true,
        ocr: true,
        ocrConfig: {
          language: "chi_sim+eng",
          langPath,
          timeout: { workerLoad: 30_000, recognition: 30_000, autoTerminate: 1_000 }
        },
        decompressionLimits: {
          maxZipEntries: MAX_ARCHIVE_ENTRIES,
          maxUncompressedBytes: MAX_ARCHIVE_UNCOMPRESSED_BYTES,
          maxTableCells: 250_000
        }
      });
      text = String((await ast.to("text")).value);
      await OfficeParser.terminateOcr();
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function ocrImage(task: PromptAttachmentWorkerTask): Promise<string> {
  const langPath = await prepareOcrData(task.ocrDataRoot);
  const worker = await createOcrWorker(["chi_sim", "eng"], undefined, {
    langPath,
    gzip: true,
    cacheMethod: "none"
  });
  try {
    const result = await worker.recognize(task.path);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

async function prepareOcrData(root: string): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const require = createRequire(import.meta.url);
  const languages = [
    { language: "eng", packageEntry: require.resolve("@tesseract.js-data/eng") },
    { language: "chi_sim", packageEntry: require.resolve("@tesseract.js-data/chi_sim") }
  ] as const;
  for (const { language, packageEntry } of languages) {
    const source = join(dirname(packageEntry), "4.0.0", `${language}.traineddata.gz`);
    const destination = join(root, `${language}.traineddata.gz`);
    await copyFile(source, destination).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  return root;
}

async function searchText(task: PromptAttachmentWorkerTask): Promise<string> {
  const query = task.query?.trim();
  if (!query) throw new Error("search requires a non-empty query.");
  const text = await readText(task);
  const lowered = query.toLocaleLowerCase();
  const matches = text.split(/\r?\n/u)
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter((item) => item.text.toLocaleLowerCase().includes(lowered))
    .slice(0, 200);
  return matches.length === 0
    ? `No matches for ${JSON.stringify(query)}.`
    : matches.map((item) => `${item.line}: ${item.text}`).join("\n");
}

async function binaryStrings(path: string): Promise<string> {
  const bytes = await readBoundedFile(path, MAX_CACHE_BYTES);
  const ascii = Buffer.from(bytes).toString("latin1").match(/[\x20-\x7e]{4,}/gu) ?? [];
  const utf16 = Buffer.from(bytes).toString("utf16le").match(/[\x20-\x7e\u0080-\uffff]{4,}/gu) ?? [];
  return [...new Set([...ascii, ...utf16])].slice(0, 1_000).join("\n");
}

async function readBytes(task: PromptAttachmentWorkerTask): Promise<string> {
  const offset = task.offset ?? 0;
  const length = Math.min(task.length ?? 4_096, 8_192);
  if (offset >= task.attachment.byteLength) throw new Error("Byte offset is outside the attachment.");
  const handle = await open(task.path, "r");
  try {
    const bytes = Buffer.alloc(Math.min(length, task.attachment.byteLength - offset));
    const result = await handle.read(bytes, 0, bytes.byteLength, offset);
    const value = bytes.subarray(0, result.bytesRead);
    return [
      `offset=${offset} length=${value.byteLength}`,
      `hex=${value.toString("hex")}`,
      `base64=${value.toString("base64")}`
    ].join("\n");
  } finally {
    await handle.close();
  }
}

async function listArchive(task: PromptAttachmentWorkerTask): Promise<unknown[]> {
  return listPromptAttachmentArchive(task);
}

async function readArchiveEntry(task: PromptAttachmentWorkerTask): Promise<string> {
  const entry = task.entry;
  if (!entry) throw new Error("read_archive_entry requires an entry name.");
  const bytes = await readPromptAttachmentArchiveEntry(task, entry);
  if (looksText(bytes)) return decodeText(bytes);
  return `entry=${entry}\nbase64=${Buffer.from(bytes).toString("base64")}`;
}

async function readBoundedFile(path: string, limit: number): Promise<Buffer> {
  const fileStat = await stat(path);
  const length = Math.min(fileStat.size, limit);
  const handle = await open(path, "r");
  try {
    const bytes = Buffer.alloc(length);
    const result = await handle.read(bytes, 0, length, 0);
    return bytes.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

function decodeText(bytes: Uint8Array): string {
  const encoding = normalizeEncoding(detect(bytes));
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

function normalizeEncoding(value: string | null): string {
  if (!value) return "utf-8";
  const normalized = value.toLowerCase().replaceAll("_", "-");
  if (normalized === "ascii") return "utf-8";
  if (normalized === "gb18030") return "gb18030";
  return normalized;
}

function boundText(value: string): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= MAX_RESULT_BYTES) return { text: value, truncated: false };
  const suffix = "\n[Attachment tool output truncated at 32 KiB.]";
  const budget = MAX_RESULT_BYTES - Buffer.byteLength(suffix);
  let prefix = bytes.subarray(0, budget).toString("utf8");
  while (prefix.endsWith("\uFFFD")) prefix = prefix.slice(0, -1);
  return { text: `${prefix}${suffix}`, truncated: true };
}

function boundedError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/[\r\n]+/gu, " ").slice(0, 1_000) || "Attachment extraction failed.";
}

function isOfficeDocument(name: string, mimeType: string): boolean {
  return /\.(?:pdf|docx|xlsx|pptx|odt|ods|odp|rtf|epub|html?|md|csv)$/iu.test(name)
    || /pdf|officedocument|opendocument|rtf|epub|html|csv/iu.test(mimeType);
}

function looksText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4_096);
  let controls = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controls += 1;
  }
  return sample.length === 0 || controls / sample.length < 0.02;
}
