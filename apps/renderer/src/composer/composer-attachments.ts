import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_TRANSFER_IMAGE_BYTES,
  MAX_TRANSFER_IMAGE_COUNT,
  MAX_TRANSFER_IMAGE_TOTAL_BYTES,
  type TransferImage
} from "@pi67/protocol";

export interface DraftAttachment {
  id: string;
  file: File;
  previewUrl: string;
}

export function createDraftAttachments(
  files: Iterable<File>,
  current: readonly DraftAttachment[]
): DraftAttachment[] {
  const selected = [...files];
  if (selected.length === 0) return [...current];
  if (current.length + selected.length > MAX_TRANSFER_IMAGE_COUNT) {
    throw new Error(`每条消息最多添加 ${MAX_TRANSFER_IMAGE_COUNT} 张图片。`);
  }

  const identities = new Set(current.map((attachment) => fileIdentity(attachment.file)));
  let totalBytes = current.reduce((sum, attachment) => sum + attachment.file.size, 0);
  for (const file of selected) {
    if (!ALLOWED_IMAGE_MIME_TYPES.some((mimeType) => mimeType === file.type)) {
      throw new Error(`不支持 ${file.name} 的图片格式。`);
    }
    if (file.size > MAX_TRANSFER_IMAGE_BYTES) {
      throw new Error(`${file.name} 超过单张 10 MiB 限制。`);
    }
    const identity = fileIdentity(file);
    if (identities.has(identity)) throw new Error(`${file.name} 已经添加。`);
    identities.add(identity);
    totalBytes += file.size;
    if (totalBytes > MAX_TRANSFER_IMAGE_TOTAL_BYTES) {
      throw new Error("图片总大小超过每条消息 30 MiB 限制。");
    }
  }

  const created: DraftAttachment[] = [];
  try {
    for (const file of selected) {
      created.push({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) });
    }
  } catch (error) {
    revokeDraftAttachments(created);
    throw error;
  }
  return [...current, ...created];
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
  if (removed) URL.revokeObjectURL(removed.previewUrl);
  return attachments.filter((attachment) => attachment.id !== id);
}

export function revokeDraftAttachments(attachments: readonly DraftAttachment[]): void {
  for (const attachment of attachments) URL.revokeObjectURL(attachment.previewUrl);
}

export async function toTransferImages(attachments: readonly DraftAttachment[]): Promise<TransferImage[]> {
  return Promise.all(attachments.map(async ({ file }) => ({
    name: file.name,
    mimeType: file.type,
    data: await file.arrayBuffer()
  })));
}

export function formatAttachmentFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
}

function fileIdentity(file: File): string {
  return `${file.name}\0${file.type}\0${file.size}\0${file.lastModified}`;
}
