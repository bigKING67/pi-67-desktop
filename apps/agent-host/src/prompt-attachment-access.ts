import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
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
  MAX_PROMPT_ATTACHMENT_TOTAL_BYTES,
  type PromptAttachmentRef
} from "@pi67/protocol";
import { PromptAttachmentWorkerPool } from "./prompt-attachment-worker-client.js";

interface StagedManifest extends PreparedPromptAttachment {
  version: 1;
  sha256: string;
  stagedAt: number;
}

interface ClaimedManifest {
  version: 1;
  submissionKey: string;
  sourceIds: string[];
  set: PreparedPromptAttachmentSet;
}

interface ClaimedSetRecord {
  taskKey: string;
  directory: string;
  set: PreparedPromptAttachmentSet;
}

export interface PromptAttachmentAccessOwner {
  forTask(taskKey: string): PromptAttachmentAccess;
  dispose(): Promise<void>;
}

export function createPromptAttachmentAccessOwner(root: string | undefined): PromptAttachmentAccessOwner | undefined {
  return root ? new AgentHostPromptAttachmentAccess(resolve(root)) : undefined;
}

class AgentHostPromptAttachmentAccess implements PromptAttachmentAccessOwner {
  private readonly draftRoot: string;
  private readonly claimedRoot: string;
  private readonly records = new Map<string, ClaimedSetRecord>();
  private readonly workers: PromptAttachmentWorkerPool;

  constructor(private readonly root: string) {
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

  dispose(): Promise<void> {
    this.records.clear();
    return this.workers.dispose();
  }

  private async claim(
    taskKey: string,
    submissionId: string,
    refs: readonly PromptAttachmentRef[]
  ): Promise<PreparedPromptAttachmentSet | undefined> {
    if (refs.length === 0) return undefined;
    if (refs.length > MAX_PROMPT_ATTACHMENT_COUNT) throw new Error("Prompt attachment count exceeds the limit.");
    const sourceIds = refs.map((ref) => assertOpaqueId(ref.id));
    if (new Set(sourceIds).size !== sourceIds.length) throw new Error("Prompt attachment references must be unique.");
    const taskDirectory = join(this.claimedRoot, stableKey(taskKey));
    const submissionKey = stableKey(submissionId);
    const destination = join(taskDirectory, submissionKey);
    await mkdir(taskDirectory, { recursive: true, mode: 0o700 });

    const existing = await readClaimedManifest(destination).catch(() => undefined);
    if (existing) return this.adoptExisting(taskKey, destination, sourceIds, existing);

    const temporary = join(taskDirectory, `.claim-${submissionKey}-${randomUUID()}`);
    const itemsRoot = join(temporary, "items");
    await mkdir(itemsRoot, { recursive: true, mode: 0o700 });
    const moved: Array<{ id: string; from: string; to: string }> = [];
    try {
      const attachments: PreparedPromptAttachment[] = [];
      let totalBytes = 0;
      for (const id of sourceIds) {
        const from = join(this.draftRoot, id);
        const to = join(itemsRoot, id);
        const manifest = await validateStagedAttachment(this.draftRoot, from, id);
        totalBytes += manifest.byteLength;
        if (totalBytes > MAX_PROMPT_ATTACHMENT_TOTAL_BYTES) {
          throw new Error("Prompt attachments exceed the 250 MiB per-draft limit.");
        }
        await rename(from, to);
        moved.push({ id, from, to });
        attachments.push(publicAttachment(manifest));
      }
      const set: PreparedPromptAttachmentSet = {
        id: randomUUID().replaceAll("-", "_"),
        attachments
      };
      const claimed: ClaimedManifest = { version: 1, submissionKey, sourceIds, set };
      await writeFile(join(temporary, "set.json"), `${JSON.stringify(claimed)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      });
      try {
        await rename(temporary, destination);
      } catch (error: unknown) {
        const concurrent = await readClaimedManifest(destination).catch(() => undefined);
        if (!concurrent) throw error;
        await rm(temporary, { recursive: true, force: true });
        return this.adoptExisting(taskKey, destination, sourceIds, concurrent);
      }
      this.records.set(set.id, { taskKey, directory: destination, set });
      return set;
    } catch (error) {
      for (const item of moved.reverse()) {
        await rename(item.to, item.from).catch(() => undefined);
      }
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
    const record = this.requireRecord(taskKey, setId);
    return Promise.all(record.set.attachments
      .filter((attachment) => attachment.kind === "image")
      .map(async (attachment) => ({
        type: "image" as const,
        mimeType: attachment.mimeType,
        data: (await readFile(payloadPath(record, attachment.id))).toString("base64")
      })));
  }

  private async read(
    taskKey: string,
    request: PromptAttachmentReadRequest,
    signal?: AbortSignal
  ): Promise<PromptAttachmentReadResult> {
    const record = this.requireRecord(taskKey, assertOpaqueId(request.setId));
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
    const result = await this.workers.run({
      path: payloadPath(record, attachment.id),
      attachment,
      operation: request.operation,
      ...(request.query === undefined ? {} : { query: request.query }),
      ...(request.offset === undefined ? {} : { offset: request.offset }),
      ...(request.length === undefined ? {} : { length: request.length }),
      ...(request.entry === undefined ? {} : { entry: request.entry })
    }, signal);
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

  private requireRecord(taskKey: string, setId: string): ClaimedSetRecord {
    const record = this.records.get(setId);
    if (!record || record.taskKey !== taskKey) throw new Error("Prompt attachment set is unavailable for this Task.");
    return record;
  }
}

async function validateStagedAttachment(
  draftRoot: string,
  directory: string,
  expectedId: string
): Promise<StagedManifest> {
  const directoryStat = await lstat(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error("Staged attachment directory is invalid.");
  const [canonicalDirectory, canonicalDraftRoot] = await Promise.all([
    realpath(directory),
    realpath(draftRoot)
  ]);
  if (canonicalDirectory !== join(canonicalDraftRoot, expectedId)) {
    throw new Error("Staged attachment path is not canonical.");
  }
  const manifest = parseStagedManifest(await readFile(join(directory, "manifest.json"), "utf8"));
  if (manifest.id !== expectedId) throw new Error("Staged attachment identity does not match its directory.");
  const path = join(directory, "payload.bin");
  const payloadStat = await lstat(path);
  if (payloadStat.isSymbolicLink() || !payloadStat.isFile() || payloadStat.size !== manifest.byteLength) {
    throw new Error("Staged attachment payload is invalid.");
  }
  if (await sha256File(path) !== manifest.sha256) throw new Error("Staged attachment integrity check failed.");
  return manifest;
}

async function readClaimedManifest(directory: string): Promise<ClaimedManifest> {
  const value = JSON.parse(await readFile(join(directory, "set.json"), "utf8")) as unknown;
  const record = asRecord(value);
  const setRecord = asRecord(record.set);
  if (record.version !== 1 || typeof record.submissionKey !== "string" || !Array.isArray(record.sourceIds)) {
    throw new Error("Claimed attachment manifest is invalid.");
  }
  const attachments = Array.isArray(setRecord.attachments)
    ? setRecord.attachments.map(parsePreparedAttachment)
    : [];
  const setId = assertOpaqueId(setRecord.id);
  const sourceIds = record.sourceIds.map(assertOpaqueId);
  if (attachments.length !== sourceIds.length) throw new Error("Claimed attachment manifest is incomplete.");
  return {
    version: 1,
    submissionKey: record.submissionKey,
    sourceIds,
    set: { id: setId, attachments }
  };
}

function parseStagedManifest(value: string): StagedManifest {
  const record = asRecord(JSON.parse(value) as unknown);
  const attachment = parsePreparedAttachment(record);
  if (record.version !== 1 || typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(record.sha256)) {
    throw new Error("Staged attachment manifest is invalid.");
  }
  return {
    version: 1,
    ...attachment,
    sha256: record.sha256,
    stagedAt: typeof record.stagedAt === "number" ? record.stagedAt : 0
  };
}

function parsePreparedAttachment(value: unknown): PreparedPromptAttachment {
  const record = asRecord(value);
  const kind = record.kind;
  if (typeof record.name !== "string" || record.name.length === 0 || record.name.length > 512) {
    throw new Error("Prompt attachment name is invalid.");
  }
  if (typeof record.mimeType !== "string" || record.mimeType.length > 128) {
    throw new Error("Prompt attachment MIME type is invalid.");
  }
  if (!Number.isSafeInteger(record.byteLength) || Number(record.byteLength) < 0) {
    throw new Error("Prompt attachment byte length is invalid.");
  }
  if (!isAttachmentKind(kind)) throw new Error("Prompt attachment kind is invalid.");
  return {
    id: assertOpaqueId(record.id),
    name: record.name,
    mimeType: record.mimeType,
    byteLength: Number(record.byteLength),
    kind
  };
}

function isAttachmentKind(value: unknown): value is PreparedPromptAttachment["kind"] {
  return value === "image" || value === "document" || value === "archive"
    || value === "audio" || value === "video" || value === "file";
}

function publicAttachment(manifest: StagedManifest): PreparedPromptAttachment {
  return {
    id: manifest.id,
    name: manifest.name,
    mimeType: manifest.mimeType,
    byteLength: manifest.byteLength,
    kind: manifest.kind
  };
}

function payloadPath(record: ClaimedSetRecord, attachmentId: string): string {
  return join(record.directory, "items", attachmentId, "payload.bin");
}

function stableKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertOpaqueId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
    throw new Error("Prompt attachment id is invalid.");
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", () => resolveHash(hash.digest("hex")));
    stream.once("error", reject);
  });
}
