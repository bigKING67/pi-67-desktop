import {
  MAX_PROMPT_ATTACHMENT_BYTES,
  MAX_PROMPT_ATTACHMENT_COUNT,
  MAX_PROMPT_ATTACHMENT_NAME_CHARS,
  MAX_PROMPT_ATTACHMENT_TOTAL_BYTES,
  MAX_PROMPT_PATHLESS_ATTACHMENT_BYTES
} from "@pi67/protocol/prompt-attachment-limits";
import type { StagedPromptAttachment } from "@pi67/protocol";

interface PromptAttachmentFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly lastModified: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface PromptAttachmentPreloadOptions<TFile extends PromptAttachmentFile> {
  getPathForFile(file: TFile): string;
  invoke(channel: string, value: unknown): Promise<unknown>;
}

export async function stagePromptAttachmentsFromPreload<TFile extends PromptAttachmentFile>(
  files: readonly TFile[],
  options: PromptAttachmentPreloadOptions<TFile>
): Promise<StagedPromptAttachment[]> {
  if (files.length === 0 || files.length > MAX_PROMPT_ATTACHMENT_COUNT) {
    throw new Error(`Each draft supports 1 to ${MAX_PROMPT_ATTACHMENT_COUNT} attachments.`);
  }
  let totalBytes = 0;
  const selected = files.map((file) => {
    if (!file.name || file.name.length > MAX_PROMPT_ATTACHMENT_NAME_CHARS) {
      throw new Error("Attachment file name is invalid.");
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_PROMPT_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} exceeds the 100 MiB per-file limit.`);
    }
    totalBytes += file.size;
    if (totalBytes > MAX_PROMPT_ATTACHMENT_TOTAL_BYTES) {
      throw new Error("Attachments exceed the 250 MiB per-draft limit.");
    }
    const path = options.getPathForFile(file);
    if (!path && file.size > MAX_PROMPT_PATHLESS_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} exceeds the 16 MiB clipboard attachment limit.`);
    }
    return { file, path };
  });

  const staged: StagedPromptAttachment[] = [];
  try {
    for (const { file, path } of selected) {
      const candidate = {
        name: file.name,
        mimeType: file.type,
        byteLength: file.size,
        lastModified: file.lastModified,
        ...(path ? { path } : { data: await file.arrayBuffer() })
      };
      const result = parseSingleStageResult(await options.invoke("pi67:prompt-attachments-stage", [candidate]));
      staged.push(result);
      if (result.name !== file.name || result.byteLength !== file.size) {
        throw new Error("Prompt attachment staging result does not match the selected file.");
      }
    }
    return staged;
  } catch (error) {
    if (staged.length > 0) {
      await options.invoke("pi67:prompt-attachments-release", staged.map((attachment) => attachment.id))
        .catch(() => undefined);
    }
    throw error;
  }
}

function parseSingleStageResult(value: unknown): StagedPromptAttachment {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("Prompt attachment staging returned an incomplete result.");
  }
  const record = typeof value[0] === "object" && value[0] !== null
    ? value[0] as Record<string, unknown>
    : {};
  if (typeof record.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(record.id)
    || typeof record.name !== "string" || typeof record.mimeType !== "string"
    || !Number.isSafeInteger(record.byteLength) || !isAttachmentKind(record.kind)) {
    throw new Error("Prompt attachment staging returned an invalid result.");
  }
  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    byteLength: Number(record.byteLength),
    kind: record.kind
  };
}

function isAttachmentKind(value: unknown): value is StagedPromptAttachment["kind"] {
  return value === "image" || value === "document" || value === "archive"
    || value === "audio" || value === "video" || value === "file";
}
