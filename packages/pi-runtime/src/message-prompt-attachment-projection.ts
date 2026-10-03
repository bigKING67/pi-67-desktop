import { MAX_PROJECTED_MESSAGE_PARTS, type MessagePart } from "@pi67/domain";

export interface NormalizedPromptAttachment {
  id: string;
  name: string;
  mimeType: string;
  byteLength: number;
  kind: "image" | "document" | "archive" | "audio" | "video" | "file";
}

/** Projects Desktop's hidden attachment control record into safe transcript parts. */
export function isPromptAttachmentMessage(value: unknown): boolean {
  const message = asRecord(value);
  return message.role === "custom"
    && message.customType === "pi67.desktop-attachments.v1"
    && message.display === false;
}

export function normalizePromptAttachmentMessage(value: unknown): NormalizedPromptAttachment[] | undefined {
  const message = asRecord(value);
  const details = asRecord(message.details);
  const attachments = details.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0 || attachments.length > 20) return undefined;
  const normalized = attachments.map((item) => {
    const record = asRecord(item);
    const kind = stringValue(record.kind);
    const id = stringValue(record.id);
    const name = stringValue(record.name);
    const mimeType = stringValue(record.mimeType);
    const byteLength = numberValue(record.byteLength);
    if (!id || !/^[A-Za-z0-9_-]{1,128}$/u.test(id)
      || !name || name.length > 512
      || !mimeType || mimeType.length > 128
      || byteLength === undefined || !Number.isSafeInteger(byteLength) || byteLength < 0
      || !isPromptAttachmentKind(kind)) return undefined;
    return { id, name, mimeType, byteLength, kind };
  });
  return normalized.every((item) => item !== undefined)
    ? normalized as NormalizedPromptAttachment[]
    : undefined;
}

export function mergePromptAttachments(
  parts: readonly MessagePart[],
  attachments: readonly NormalizedPromptAttachment[]
): MessagePart[] {
  const merged = parts.map((part) => ({ ...part }));
  let imageIndex = 0;
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      for (; imageIndex < merged.length; imageIndex += 1) {
        const part = merged[imageIndex];
        if (part?.type !== "image") continue;
        if (!part.name) part.name = attachment.name;
        imageIndex += 1;
        break;
      }
      continue;
    }
    merged.push({
      type: "attachment",
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      byteLength: attachment.byteLength,
      kind: attachment.kind
    });
  }
  return merged.slice(0, MAX_PROJECTED_MESSAGE_PARTS);
}

function isPromptAttachmentKind(value: string | undefined): value is NormalizedPromptAttachment["kind"] {
  return value === "image" || value === "document" || value === "archive"
    || value === "audio" || value === "video" || value === "file";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
