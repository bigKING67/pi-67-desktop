import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import {
  MAX_PROMPT_ATTACHMENT_BYTES,
  MAX_PROMPT_ATTACHMENT_COUNT,
  MAX_PROMPT_ATTACHMENT_NAME_CHARS,
  MAX_PROMPT_ATTACHMENT_TOTAL_BYTES,
  MAX_PROMPT_PATHLESS_ATTACHMENT_BYTES,
  type PromptAttachmentKind,
  type StagedPromptAttachment
} from "@pi67/protocol";

export interface PromptAttachmentStageCandidate {
  name: string;
  mimeType: string;
  byteLength: number;
  lastModified: number;
  path?: string;
  data?: ArrayBuffer;
}

interface PromptAttachmentManifest extends StagedPromptAttachment {
  version: 1;
  sha256: string;
  stagedAt: number;
}

export class PromptAttachmentStagingService {
  readonly root: string;
  readonly draftRoot: string;
  readonly claimedRoot: string;

  constructor(root: string) {
    this.root = resolve(root);
    this.draftRoot = join(this.root, "draft");
    this.claimedRoot = join(this.root, "claimed");
  }

  async stage(value: unknown): Promise<StagedPromptAttachment[]> {
    const candidates = validateCandidates(value);
    await this.ensureRoots();
    const staged: StagedPromptAttachment[] = [];
    try {
      for (const candidate of candidates) staged.push(await this.stageOne(candidate));
      return staged;
    } catch (error) {
      await Promise.all(staged.map((attachment) => this.releaseOne(attachment.id)));
      throw error;
    }
  }

  async release(value: unknown): Promise<void> {
    if (!Array.isArray(value) || value.length > MAX_PROMPT_ATTACHMENT_COUNT) {
      throw new Error("Invalid prompt attachment release request.");
    }
    const ids = value.map(assertOpaqueId);
    await Promise.all(ids.map((id) => this.releaseOne(id)));
  }

  async cleanup(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

  private async ensureRoots(): Promise<void> {
    await mkdir(this.draftRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.claimedRoot, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      await Promise.all([chmod(this.root, 0o700), chmod(this.draftRoot, 0o700), chmod(this.claimedRoot, 0o700)]);
    }
  }

  private async stageOne(candidate: PromptAttachmentStageCandidate): Promise<StagedPromptAttachment> {
    const id = randomUUID().replaceAll("-", "_");
    const directory = join(this.draftRoot, id);
    const payloadPath = join(directory, "payload.bin");
    await mkdir(directory, { mode: 0o700 });
    try {
      const copied = candidate.path
        ? await copyPathCandidate(candidate.path, payloadPath)
        : await copyBufferCandidate(candidate, payloadPath);
      if (copied.byteLength !== candidate.byteLength) {
        throw new Error(`${candidate.name} changed while it was being attached. Select it again.`);
      }
      const header = await readHeader(payloadPath);
      const mimeType = detectMimeType(header, candidate.mimeType, candidate.name);
      const manifest: PromptAttachmentManifest = {
        version: 1,
        id,
        name: candidate.name,
        mimeType,
        byteLength: copied.byteLength,
        kind: attachmentKind(mimeType, candidate.name),
        sha256: copied.sha256,
        stagedAt: Date.now()
      };
      const temporaryManifest = join(directory, "manifest.json.tmp");
      await writeFile(temporaryManifest, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryManifest, join(directory, "manifest.json"));
      return publicManifest(manifest);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private async releaseOne(id: string): Promise<void> {
    await rm(join(this.draftRoot, id), { recursive: true, force: true });
  }
}

function validateCandidates(value: unknown): PromptAttachmentStageCandidate[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PROMPT_ATTACHMENT_COUNT) {
    throw new Error(`Each draft supports 1 to ${MAX_PROMPT_ATTACHMENT_COUNT} attachments.`);
  }
  let totalBytes = 0;
  return value.map((item) => {
    const record = asRecord(item);
    const name = assertFileName(record.name);
    const mimeType = typeof record.mimeType === "string" && record.mimeType.length <= 128
      ? record.mimeType.trim().toLowerCase()
      : "";
    const byteLength = assertByteLength(record.byteLength, MAX_PROMPT_ATTACHMENT_BYTES, name);
    const lastModified = typeof record.lastModified === "number" && Number.isFinite(record.lastModified)
      ? record.lastModified
      : 0;
    const path = typeof record.path === "string" && record.path.length > 0 ? record.path : undefined;
    const data = record.data instanceof ArrayBuffer ? record.data : undefined;
    if ((path === undefined) === (data === undefined)) {
      throw new Error(`${name} must use exactly one attachment transfer source.`);
    }
    if (path !== undefined && (!isAbsolute(path) || path.length > 32_768)) {
      throw new Error(`${name} does not have a valid native file path.`);
    }
    if (data !== undefined && data.byteLength > MAX_PROMPT_PATHLESS_ATTACHMENT_BYTES) {
      throw new Error(`${name} exceeds the 16 MiB clipboard attachment limit.`);
    }
    if (data !== undefined && data.byteLength !== byteLength) {
      throw new Error(`${name} has inconsistent clipboard attachment bytes.`);
    }
    totalBytes += byteLength;
    if (totalBytes > MAX_PROMPT_ATTACHMENT_TOTAL_BYTES) {
      throw new Error("Attachments exceed the 250 MiB per-draft limit.");
    }
    return {
      name,
      mimeType,
      byteLength,
      lastModified,
      ...(path === undefined ? {} : { path }),
      ...(data === undefined ? {} : { data })
    };
  });
}

async function copyPathCandidate(sourcePath: string, destination: string): Promise<{ byteLength: number; sha256: string }> {
  const sourceLstat = await lstat(sourcePath);
  if (sourceLstat.isSymbolicLink() || !sourceLstat.isFile()) {
    throw new Error("Attachment source must be a regular file, not a link or directory.");
  }
  const canonicalPath = await realpath(sourcePath);
  const canonicalStat = await stat(canonicalPath);
  if (!canonicalStat.isFile()) throw new Error("Attachment source is not a regular file.");
  if (canonicalStat.size > MAX_PROMPT_ATTACHMENT_BYTES) {
    throw new Error("Attachment exceeds the 100 MiB per-file limit.");
  }
  const handle = await open(canonicalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || openedStat.size !== canonicalStat.size) {
      throw new Error("Attachment changed before it could be staged.");
    }
    return await copyAndHash(
      createReadStream(canonicalPath, { fd: handle.fd, autoClose: false }),
      destination
    );
  } finally {
    await handle.close();
  }
}

async function copyBufferCandidate(
  candidate: PromptAttachmentStageCandidate,
  destination: string
): Promise<{ byteLength: number; sha256: string }> {
  const bytes = new Uint8Array(candidate.data!);
  await writeFile(destination, bytes, { mode: 0o600, flag: "wx" });
  return {
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

async function copyAndHash(
  source: NodeJS.ReadableStream,
  destination: string
): Promise<{ byteLength: number; sha256: string }> {
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
  await pipeline(source, meter, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
  return { byteLength, sha256: hash.digest("hex") };
}

async function readHeader(path: string): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const bytes = Buffer.alloc(4_100);
    const result = await handle.read(bytes, 0, bytes.byteLength, 0);
    return bytes.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

function detectMimeType(header: Uint8Array, declared: string, name: string): string {
  if (startsWith(header, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(header, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(header, 0, 4) === "GIF8") return "image/gif";
  if (ascii(header, 0, 4) === "RIFF" && ascii(header, 8, 4) === "WEBP") return "image/webp";
  if (ascii(header, 0, 5) === "%PDF-") return "application/pdf";
  if (startsWith(header, [0x50, 0x4b, 0x03, 0x04])) return officeOrZipMime(name);
  if (startsWith(header, [0x1f, 0x8b])) return "application/gzip";
  return declared || mimeFromExtension(name) || "application/octet-stream";
}

function attachmentKind(mimeType: string, name: string): PromptAttachmentKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (/zip|gzip|tar|7z|rar/iu.test(mimeType) || /\.(?:zip|tar|tgz|gz)$/iu.test(name)) return "archive";
  if (mimeType.startsWith("text/") || /pdf|word|excel|spreadsheet|presentation|opendocument|rtf|epub/iu.test(mimeType)) {
    return "document";
  }
  return "file";
}

function officeOrZipMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".epub")) return "application/epub+zip";
  return "application/zip";
}

function mimeFromExtension(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (/\.(?:txt|md|markdown|csv|tsv|log|json|jsonl|ya?ml|toml|xml|html?|css|[cm]?[jt]sx?|py|rs|go|java|kt|swift|sql|sh|ps1)$/u.test(lower)) return "text/plain";
  if (lower.endsWith(".rtf")) return "application/rtf";
  if (lower.endsWith(".tar")) return "application/x-tar";
  if (lower.endsWith(".gz") || lower.endsWith(".tgz")) return "application/gzip";
  return undefined;
}

function assertFileName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PROMPT_ATTACHMENT_NAME_CHARS) {
    throw new Error("Attachment file name is invalid.");
  }
  if (value.includes("\0") || value.includes("/") || value.includes("\\") || basename(value) !== value) {
    throw new Error("Attachment file name must not contain a path.");
  }
  return value;
}

function assertByteLength(value: unknown, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(`${name} exceeds the 100 MiB per-file limit.`);
  }
  return Number(value);
}

function assertOpaqueId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new Error("Prompt attachment id is invalid.");
  }
  return value;
}

function publicManifest(manifest: PromptAttachmentManifest): StagedPromptAttachment {
  return {
    id: manifest.id,
    name: manifest.name,
    mimeType: manifest.mimeType,
    byteLength: manifest.byteLength,
    kind: manifest.kind
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
