import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  PreparedPromptAttachment,
  PreparedPromptImage,
  PreparedPromptAttachmentSet,
  PromptAttachmentAccess,
  PromptAttachmentReadRequest,
  PromptAttachmentReadResult
} from "@pi67/pi-runtime";
import {
  MAX_PROMPT_ATTACHMENT_COUNT,
  MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES,
  MAX_PROMPT_ATTACHMENT_TOTAL_BYTES,
  type PromptAttachmentRef
} from "@pi67/protocol";
import {
  assertClaimCapacity,
  cleanupTemporaryClaimDirectories,
  type ClaimedManifest,
  type ClaimedSetRecord,
  recoverClaimedManifestBySourceIds,
  recoverClaimedRecord,
  stableKey,
  validateClaimedSet
} from "./prompt-attachment-claimed-storage.js";
import {
  assertOpaqueId,
  assertSameAttachment,
  copyVerifiedStagedAttachment,
  publicAttachment,
  readVerifiedStagedAttachmentBytes,
  toTransferableArrayBuffer,
  writePrivateTextFile
} from "./prompt-attachment-payload-storage.js";
import { PromptAttachmentWorkerPool } from "./prompt-attachment-worker-client.js";

export interface PromptAttachmentAccessOwner {
  forTask(taskKey: string): PromptAttachmentAccess;
  releaseTask(taskKey: string): Promise<void>;
  dispose(): Promise<void>;
}

export function createPromptAttachmentAccessOwner(root: string | undefined): PromptAttachmentAccessOwner | undefined {
  return root ? new AgentHostPromptAttachmentAccess(resolve(root)) : undefined;
}

class AgentHostPromptAttachmentAccess implements PromptAttachmentAccessOwner {
  private readonly draftRoot: string;
  private readonly claimedRoot: string;
  private readonly records = new Map<string, ClaimedSetRecord>();
  private readonly claimQueues = new Map<string, Promise<void>>();
  private readonly workers: PromptAttachmentWorkerPool;

  constructor(root: string) {
    this.draftRoot = join(root, "draft");
    this.claimedRoot = join(root, "claimed");
    this.workers = new PromptAttachmentWorkerPool(join(root, "ocr-data"));
  }

  forTask(taskKey: string): PromptAttachmentAccess {
    return {
      claim: (submissionId, refs) => this.claim(taskKey, submissionId, refs),
      readImages: (setId) => this.readImages(taskKey, setId),
      read: (request, signal) => this.read(taskKey, request, signal)
    };
  }

  async releaseTask(taskKey: string): Promise<void> {
    await this.claimQueues.get(taskKey)?.catch(() => undefined);
    for (const [setId, record] of this.records) {
      if (record.taskKey === taskKey) this.records.delete(setId);
    }
    await rm(join(this.claimedRoot, stableKey(taskKey)), { recursive: true, force: true });
  }

  dispose(): Promise<void> {
    this.records.clear();
    return this.workers.dispose();
  }

  private async claim(
    taskKey: string,
    submissionId: string,
    refs: readonly PromptAttachmentRef[]
  ): Promise<PreparedPromptAttachmentSet | undefined> {
    const previous = this.claimQueues.get(taskKey) ?? Promise.resolve();
    const ready = previous.catch(() => undefined);
    let release!: () => void;
    const current = new Promise<void>((resolveCurrent) => {
      release = resolveCurrent;
    });
    const tail = ready.then(() => current);
    this.claimQueues.set(taskKey, tail);
    await ready;
    try {
      return await this.claimExclusive(taskKey, submissionId, refs);
    } finally {
      release();
      if (this.claimQueues.get(taskKey) === tail) this.claimQueues.delete(taskKey);
    }
  }

  private async claimExclusive(
    taskKey: string,
    submissionId: string,
    refs: readonly PromptAttachmentRef[]
  ): Promise<PreparedPromptAttachmentSet | undefined> {
    if (refs.length === 0) return undefined;
    if (refs.length > MAX_PROMPT_ATTACHMENT_COUNT) {
      throw new Error("Prompt attachment count exceeds the limit.");
    }
    const sourceIds = refs.map((ref) => assertOpaqueId(ref.id));
    if (new Set(sourceIds).size !== sourceIds.length) {
      throw new Error("Prompt attachment references must be unique.");
    }
    const taskDirectory = join(this.claimedRoot, stableKey(taskKey));
    const submissionKey = stableKey(submissionId);
    const destination = join(taskDirectory, submissionKey);
    await mkdir(taskDirectory, { recursive: true, mode: 0o700 });
    await cleanupTemporaryClaimDirectories(taskDirectory);

    const destinationState = await lstat(destination).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) return undefined;
      throw error;
    });
    if (destinationState) {
      const existing = await validateClaimedSet(taskDirectory, destination, submissionKey);
      return this.adoptExisting(taskKey, destination, sourceIds, existing);
    }
    const reusable = await recoverClaimedManifestBySourceIds(this.claimedRoot, taskKey, sourceIds);
    if (reusable) {
      return this.adoptExisting(taskKey, reusable.directory, sourceIds, reusable.manifest);
    }
    await assertClaimCapacity(this.claimedRoot, taskKey, taskDirectory);

    const temporary = join(taskDirectory, `.claim-${submissionKey}-${randomUUID()}`);
    const itemsRoot = join(temporary, "items");
    await mkdir(itemsRoot, { recursive: true, mode: 0o700 });
    try {
      const attachments: PreparedPromptAttachment[] = [];
      let totalBytes = 0;
      let inlineImageBytes = 0;
      for (const id of sourceIds) {
        const manifest = await copyVerifiedStagedAttachment(
          this.draftRoot,
          join(this.draftRoot, id),
          id,
          join(itemsRoot, id)
        );
        totalBytes += manifest.byteLength;
        if (totalBytes > MAX_PROMPT_ATTACHMENT_TOTAL_BYTES) {
          throw new Error("Prompt attachments exceed the 250 MiB per-draft limit.");
        }
        if (manifest.kind === "image") {
          inlineImageBytes += manifest.byteLength;
          if (inlineImageBytes > MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES) {
            throw new Error("Inline images exceed the 32 MiB per-prompt limit.");
          }
        }
        attachments.push(publicAttachment(manifest));
      }
      const set: PreparedPromptAttachmentSet = {
        id: randomUUID().replaceAll("-", "_"),
        attachments
      };
      const claimed: ClaimedManifest = {
        version: 1,
        submissionKey,
        sourceIds,
        claimedAt: Date.now(),
        set
      };
      await writePrivateTextFile(join(temporary, "set.json"), `${JSON.stringify(claimed)}\n`);
      try {
        await rename(temporary, destination);
      } catch (error: unknown) {
        const concurrent = await validateClaimedSet(taskDirectory, destination, submissionKey)
          .catch(() => undefined);
        if (!concurrent) throw error;
        await rm(temporary, { recursive: true, force: true });
        await this.releaseDrafts(sourceIds);
        return this.adoptExisting(taskKey, destination, sourceIds, concurrent);
      }
      this.records.set(set.id, { taskKey, directory: destination, set });
      await this.releaseDrafts(sourceIds);
      return set;
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  private adoptExisting(
    taskKey: string,
    directory: string,
    sourceIds: readonly string[],
    existing: ClaimedManifest
  ): PreparedPromptAttachmentSet {
    if (existing.sourceIds.length !== sourceIds.length
      || existing.sourceIds.some((id, index) => id !== sourceIds[index])) {
      throw new Error("Submission id was reused with different prompt attachments.");
    }
    this.records.set(existing.set.id, { taskKey, directory, set: existing.set });
    return existing.set;
  }

  private async readImages(taskKey: string, setId: string): Promise<PreparedPromptImage[]> {
    const record = await this.requireRecord(taskKey, setId);
    const images: PreparedPromptImage[] = [];
    let totalBytes = 0;
    for (const attachment of record.set.attachments.filter((item) => item.kind === "image")) {
      totalBytes += attachment.byteLength;
      if (totalBytes > MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES) {
        throw new Error("Inline images exceed the 32 MiB per-prompt limit.");
      }
      const verified = await this.readVerifiedPayload(record, attachment);
      images.push({
        type: "image",
        mimeType: attachment.mimeType,
        data: verified.toString("base64")
      });
    }
    return images;
  }

  private async read(
    taskKey: string,
    request: PromptAttachmentReadRequest,
    signal?: AbortSignal
  ): Promise<PromptAttachmentReadResult> {
    const record = await this.requireRecord(taskKey, assertOpaqueId(request.setId));
    if (request.operation === "list") {
      return {
        text: JSON.stringify(record.set.attachments, null, 2),
        details: { operation: request.operation, setId: record.set.id, truncated: false }
      };
    }
    const attachmentId = request.attachmentId === undefined
      ? undefined
      : assertOpaqueId(request.attachmentId);
    if (!attachmentId) throw new Error(`${request.operation} requires attachmentId.`);
    const attachment = record.set.attachments.find((item) => item.id === attachmentId);
    if (!attachment) throw new Error("Attachment id does not belong to this prompt attachment set.");
    const result = await this.workers.runDeferred({
      attachment,
      operation: request.operation,
      ...(request.query === undefined ? {} : { query: request.query }),
      ...(request.offset === undefined ? {} : { offset: request.offset }),
      ...(request.length === undefined ? {} : { length: request.length }),
      ...(request.entry === undefined ? {} : { entry: request.entry })
    }, async () => (
      toTransferableArrayBuffer(await this.readVerifiedPayload(record, attachment))
    ), signal);
    return {
      text: result.text,
      details: {
        operation: request.operation,
        setId: record.set.id,
        attachmentId,
        truncated: result.truncated
      }
    };
  }

  private async readVerifiedPayload(
    record: ClaimedSetRecord,
    attachment: PreparedPromptAttachment
  ): Promise<Buffer> {
    const itemsRoot = join(record.directory, "items");
    const verified = await readVerifiedStagedAttachmentBytes(
      itemsRoot,
      join(itemsRoot, attachment.id),
      attachment.id
    );
    assertSameAttachment(attachment, verified.manifest);
    return verified.bytes;
  }

  private async requireRecord(taskKey: string, setId: string): Promise<ClaimedSetRecord> {
    let record = this.records.get(setId);
    if (!record) {
      record = await recoverClaimedRecord(this.claimedRoot, taskKey, setId);
      if (record) this.records.set(setId, record);
    }
    if (!record || record.taskKey !== taskKey) {
      throw new Error("Prompt attachment set is unavailable for this Task.");
    }
    return record;
  }

  private async releaseDrafts(sourceIds: readonly string[]): Promise<void> {
    await Promise.all(sourceIds.map(async (id) => {
      await rm(join(this.draftRoot, id), { recursive: true, force: true }).catch(() => undefined);
    }));
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
