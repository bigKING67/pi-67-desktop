import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  createReadStream,
  createWriteStream,
  type BigIntStats
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_PROMPT_ATTACHMENT_BYTES,
  MAX_PROMPT_ATTACHMENT_COUNT,
  MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES,
  MAX_PROMPT_ATTACHMENT_TOTAL_BYTES,
  MAX_PROMPT_PATHLESS_ATTACHMENT_BYTES,
  type PromptAttachmentStagingDiagnostics,
  type StagedPromptAttachment,
  type StagedPromptAttachmentResult
} from "@pi67/protocol";
import {
  asRecord,
  assertByteLength,
  assertFileName,
  assertOpaqueId,
  attachmentKind,
  detectMimeType,
  parsePromptAttachmentManifest,
  publicManifest,
  type PromptAttachmentManifest
} from "./prompt-attachment-metadata.js";
import { MAX_PROMPT_HEIC_METADATA_BYTES } from "./prompt-image-inspection.js";
import {
  PromptImageNormalizationWorker,
  type PromptImageNormalizer
} from "./prompt-image-normalization-client.js";
import {
  normalizePromptHeicAttachment
} from "./prompt-heic-attachment-normalization.js";
import { inspectPromptAttachmentStagingDirectory } from "./prompt-attachment-staging-diagnostics.js";

export interface PromptAttachmentStageCandidate {
  name: string;
  mimeType: string;
  byteLength: number;
  lastModified: number;
  path?: string;
  data?: ArrayBuffer;
}

export interface PromptStoredImageCandidate {
  name: string;
  mimeType: string;
  bytes: Buffer;
}

export interface PromptStagedImagePayload extends StagedPromptAttachment {
  kind: "image";
  bytes: Buffer;
}

export {
  cleanupStalePromptAttachmentRuns
} from "./prompt-attachment-stale-run-cleanup.js";

const MAX_PROMPT_ATTACHMENT_MANIFEST_BYTES = 64 * 1024;

export class PromptAttachmentStagingService {
  readonly root: string;
  readonly draftRoot: string;
  readonly claimedRoot: string;
  private readonly normalizer: PromptImageNormalizer;
  private readonly normalizationControllers = new Set<AbortController>();

  constructor(root: string, options: { normalizer?: PromptImageNormalizer } = {}) {
    this.root = resolve(root);
    this.draftRoot = join(this.root, "draft");
    this.claimedRoot = join(this.root, "claimed");
    this.normalizer = options.normalizer ?? new PromptImageNormalizationWorker();
  }

  async stage(value: unknown): Promise<StagedPromptAttachmentResult[]> {
    const candidates = validateCandidates(value);
    await this.ensureRoots();
    const staged: StagedPromptAttachmentResult[] = [];
    let inlineImageBytes = 0;
    try {
      for (const candidate of candidates) {
        const attachment = await this.stageOne(candidate);
        staged.push(attachment);
        if (attachment.kind !== "image") continue;
        inlineImageBytes += attachment.byteLength;
        if (inlineImageBytes > MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES) {
          throw new Error("Inline images exceed the 32 MiB per-draft limit.");
        }
      }
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

  async readDraftImages(ids: readonly string[]): Promise<PromptStagedImagePayload[]> {
    if (ids.length === 0 || ids.length > MAX_PROMPT_ATTACHMENT_COUNT) {
      throw new Error("Invalid prompt stash image source request.");
    }
    const uniqueIds = ids.map(assertOpaqueId);
    if (new Set(uniqueIds).size !== uniqueIds.length) throw new Error("Prompt stash image sources are duplicated.");
    return Promise.all(uniqueIds.map(async (id) => {
      const directory = join(this.draftRoot, id);
      const directoryMetadata = await lstat(directory);
      if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) {
        throw new Error("Prompt stash image source is not a real staging directory.");
      }
      const manifestBytes = await readBoundedRegularFile(
        join(directory, "manifest.json"),
        MAX_PROMPT_ATTACHMENT_MANIFEST_BYTES
      );
      const manifest = parsePromptAttachmentManifest(JSON.parse(manifestBytes.toString("utf8")) as unknown);
      if (!manifest || manifest.id !== id || manifest.kind !== "image") {
        throw new Error("Only staged images can be placed in Prompt Stash.");
      }
      const handle = await open(join(directory, "payload.bin"), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const metadata = await handle.stat();
        if (!metadata.isFile() || metadata.size !== manifest.byteLength) {
          throw new Error("Prompt stash image source changed after staging.");
        }
        const bytes = await handle.readFile();
        if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) {
          throw new Error("Prompt stash image source failed integrity validation.");
        }
        return { ...publicManifest(manifest), kind: "image", bytes };
      } finally {
        await handle.close();
      }
    }));
  }

  async stageStoredImages(images: readonly PromptStoredImageCandidate[]): Promise<StagedPromptAttachment[]> {
    if (images.length === 0 || images.length > MAX_PROMPT_ATTACHMENT_COUNT) {
      throw new Error("Invalid Prompt Stash image restore request.");
    }
    await this.ensureRoots();
    const staged: StagedPromptAttachment[] = [];
    let totalBytes = 0;
    try {
      for (const image of images) {
        const name = assertFileName(image.name);
        const mimeType = image.mimeType.trim().toLowerCase();
        if (!ALLOWED_IMAGE_MIME_TYPES.includes(mimeType as typeof ALLOWED_IMAGE_MIME_TYPES[number])) {
          throw new Error("Prompt Stash contains an unsupported image type.");
        }
        totalBytes += image.bytes.byteLength;
        if (image.bytes.byteLength > MAX_PROMPT_ATTACHMENT_BYTES || totalBytes > MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES) {
          throw new Error("Prompt Stash images exceed the restore limit.");
        }
        const attachment = await this.stageOne({
          name,
          mimeType,
          byteLength: image.bytes.byteLength,
          lastModified: 0,
          data: Uint8Array.from(image.bytes).buffer
        });
        if (attachment.kind !== "image") throw new Error("Prompt Stash restored a non-image payload.");
        staged.push(attachment);
      }
      return staged;
    } catch (error) {
      await Promise.all(staged.map((attachment) => this.releaseOne(attachment.id)));
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    for (const controller of this.normalizationControllers) controller.abort();
    await this.normalizer.dispose();
    await rm(this.root, { recursive: true, force: true });
  }

  async diagnostics(): Promise<PromptAttachmentStagingDiagnostics> {
    const [drafts, claimed] = await Promise.all([
      inspectPromptAttachmentStagingDirectory(this.draftRoot),
      inspectPromptAttachmentStagingDirectory(this.claimedRoot)
    ]);
    return {
      draftCount: drafts.directoryCount,
      claimedCount: claimed.directoryCount,
      invalidEntryCount: drafts.invalidEntryCount + claimed.invalidEntryCount,
      truncated: drafts.truncated || claimed.truncated
    };
  }

  private async ensureRoots(): Promise<void> {
    await mkdir(this.draftRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.claimedRoot, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      await Promise.all([chmod(this.root, 0o700), chmod(this.draftRoot, 0o700), chmod(this.claimedRoot, 0o700)]);
    }
  }

  private async stageOne(candidate: PromptAttachmentStageCandidate): Promise<StagedPromptAttachmentResult> {
    const id = randomUUID().replaceAll("-", "_");
    const directory = join(this.draftRoot, id);
    const payloadPath = join(directory, "payload.bin");
    await mkdir(directory, { mode: 0o700 });
    try {
      const copied = candidate.path
        ? await copyPathCandidate(candidate, payloadPath)
        : await copyBufferCandidate(candidate, payloadPath);
      if (copied.byteLength !== candidate.byteLength) {
        throw new Error(`${candidate.name} changed while it was being attached. Select it again.`);
      }
      const metadataBytes = await readHeader(payloadPath, MAX_PROMPT_HEIC_METADATA_BYTES);
      let normalized: Awaited<ReturnType<typeof normalizePromptHeicAttachment>>;
      const controller = new AbortController();
      this.normalizationControllers.add(controller);
      try {
        normalized = await normalizePromptHeicAttachment({
          source: candidate,
          copiedByteLength: copied.byteLength,
          metadataBytes,
          payloadPath,
          directory,
          normalizer: this.normalizer,
          signal: controller.signal
        });
      } finally {
        this.normalizationControllers.delete(controller);
      }
      let name = candidate.name;
      let byteLength = copied.byteLength;
      let sha256 = copied.sha256;
      let mimeType: string;
      if (normalized) {
        ({ name, byteLength, sha256, mimeType } = normalized);
      } else {
        mimeType = detectMimeType(metadataBytes.subarray(0, 4_100), candidate.mimeType, candidate.name);
      }
      const manifest: PromptAttachmentManifest = {
        version: 1,
        id,
        name,
        mimeType,
        byteLength,
        kind: attachmentKind(mimeType, name),
        sha256,
        stagedAt: Date.now()
      };
      const temporaryManifest = join(directory, "manifest.json.tmp");
      await writeFile(temporaryManifest, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryManifest, join(directory, "manifest.json"));
      const attachment = publicManifest(manifest);
      return normalized === undefined
        ? attachment
        : { ...attachment, normalization: normalized.normalization };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private async releaseOne(id: string): Promise<void> {
    await rm(join(this.draftRoot, id), { recursive: true, force: true });
  }
}

async function readBoundedRegularFile(path: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maximumBytes) {
      throw new Error("Prompt attachment manifest exceeds its boundary.");
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maximumBytes) throw new Error("Prompt attachment manifest exceeds its boundary.");
    return bytes;
  } finally {
    await handle.close();
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

async function copyPathCandidate(
  candidate: PromptAttachmentStageCandidate,
  destination: string
): Promise<{ byteLength: number; sha256: string }> {
  const sourcePath = candidate.path!;
  const sourceLstat = await lstat(sourcePath, { bigint: true });
  if (sourceLstat.isSymbolicLink() || !sourceLstat.isFile()) {
    throw new Error("Attachment source must be a regular file, not a link or directory.");
  }
  if (sourceLstat.size > BigInt(MAX_PROMPT_ATTACHMENT_BYTES)) {
    throw new Error("Attachment exceeds the 100 MiB per-file limit.");
  }
  const handle = await open(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedStat = await handle.stat({ bigint: true });
    if (!openedStat.isFile() || !samePhysicalFile(sourceLstat, openedStat)) {
      throw new Error("Attachment changed before it could be staged.");
    }
    if (openedStat.size !== BigInt(candidate.byteLength) || selectedMtimeChanged(candidate.lastModified, openedStat)) {
      throw new Error(`${candidate.name} changed after it was selected. Select it again.`);
    }
    const copied = await copyAndHash(
      createReadStream(sourcePath, { fd: handle.fd, autoClose: false }),
      destination
    );
    const completedStat = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(openedStat, completedStat) || copied.byteLength !== Number(completedStat.size)) {
      throw new Error(`${candidate.name} changed while it was being attached. Select it again.`);
    }
    return copied;
  } finally {
    await handle.close();
  }
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

function selectedMtimeChanged(lastModified: number, opened: BigIntStats): boolean {
  if (lastModified <= 0) return false;
  const selectedMs = Math.trunc(lastModified);
  const openedMs = Number(opened.mtimeNs / 1_000_000n);
  return Math.abs(selectedMs - openedMs) > 1;
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

async function readHeader(path: string, maximumBytes = 4_100): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const bytes = Buffer.alloc(maximumBytes);
    const result = await handle.read(bytes, 0, bytes.byteLength, 0);
    return bytes.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}
