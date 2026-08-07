import {
  MAX_PROMPT_ATTACHMENT_BYTES,
  MAX_PROMPT_ATTACHMENT_COUNT,
  MAX_PROMPT_ATTACHMENT_NAME_CHARS,
  MAX_PROMPT_ATTACHMENT_TOTAL_BYTES,
  MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES,
  type StagedPromptAttachment
} from "@pi67/protocol";

export interface DraftAttachment extends StagedPromptAttachment {
  identity: string;
  previewUrl?: string;
}

export async function stageDraftAttachments(
  files: Iterable<File>,
  current: readonly DraftAttachment[]
): Promise<DraftAttachment[]> {
  const selected = [...files];
  if (selected.length === 0) return [...current];
  validateSelectedFiles(selected, current);
  const staged = await window.pi67.system.stagePromptAttachments(selected);
  if (staged.length !== selected.length) {
    await releaseAttachmentIds(staged.map((attachment) => attachment.id));
    throw new Error("附件暂存结果不完整，请重新选择。");
  }
  const created: DraftAttachment[] = [];
  try {
    for (let index = 0; index < staged.length; index += 1) {
      const attachment = staged[index];
      const file = selected[index];
      if (!attachment || !file || attachment.name !== file.name || attachment.byteLength !== file.size) {
        throw new Error("附件暂存结果与所选文件不一致，请重新选择。");
      }
      created.push({
        ...attachment,
        identity: fileIdentity(file),
        ...(attachment.kind === "image" ? { previewUrl: URL.createObjectURL(file) } : {})
      });
    }
    const inlineImageBytes = [...current, ...created]
      .filter((attachment) => attachment.kind === "image")
      .reduce((sum, attachment) => sum + attachment.byteLength, 0);
    if (inlineImageBytes > MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES) {
      throw new Error("图片总大小超过每条消息 32 MiB 限制。");
    }
    return [...current, ...created];
  } catch (error) {
    revokeObjectUrls(created);
    await releaseAttachmentIds(staged.map((attachment) => attachment.id));
    throw error;
  }
}

export function filesFromTransfer(transfer: DataTransfer): File[] {
  const itemFiles = [...transfer.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  return itemFiles.length > 0 ? itemFiles : [...transfer.files];
}

export function transferContainsFiles(transfer: DataTransfer): boolean {
  return [...transfer.types].some((type) => type === "Files")
    || [...transfer.items].some((item) => item.kind === "file");
}

export function removeDraftAttachment(
  attachments: readonly DraftAttachment[],
  id: string
): DraftAttachment[] {
  const removed = attachments.find((attachment) => attachment.id === id);
  if (removed) {
    revokeObjectUrls([removed]);
    void releaseAttachmentIds([removed.id]);
  }
  return attachments.filter((attachment) => attachment.id !== id);
}

export function revokeDraftAttachments(attachments: readonly DraftAttachment[]): void {
  revokeObjectUrls(attachments);
  void releaseAttachmentIds(attachments.map((attachment) => attachment.id));
}

function validateSelectedFiles(files: readonly File[], current: readonly DraftAttachment[]): void {
  if (current.length + files.length > MAX_PROMPT_ATTACHMENT_COUNT) {
    throw new Error(`每条消息最多添加 ${MAX_PROMPT_ATTACHMENT_COUNT} 个附件。`);
  }
  const identities = new Set(current.map((attachment) => attachment.identity));
  let totalBytes = current.reduce((sum, attachment) => sum + attachment.byteLength, 0);
  for (const file of files) {
    if (!file.name || file.name.length > MAX_PROMPT_ATTACHMENT_NAME_CHARS) {
      throw new Error("附件文件名为空或过长。");
    }
    if (file.size > MAX_PROMPT_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} 超过单文件 100 MiB 限制。`);
    }
    const identity = fileIdentity(file);
    if (identities.has(identity)) throw new Error(`${file.name} 已经添加。`);
    identities.add(identity);
    totalBytes += file.size;
    if (totalBytes > MAX_PROMPT_ATTACHMENT_TOTAL_BYTES) {
      throw new Error("附件总大小超过每条消息 250 MiB 限制。");
    }
  }
}

function revokeObjectUrls(attachments: readonly DraftAttachment[]): void {
  for (const attachment of attachments) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }
}

function releaseAttachmentIds(ids: readonly string[]): Promise<void> {
  return ids.length === 0 ? Promise.resolve() : window.pi67.system.releasePromptAttachments([...ids]);
}

function fileIdentity(file: File): string {
  return `${file.name}\0${file.type}\0${file.size}\0${file.lastModified}`;
}
