import { teamChatCodePointLength } from "./team-chat.js";

/** Team Chat attachments (ADR 0009). The service decides; these mirror its rules. */
export const TEAM_CHAT_ATTACHMENT_LIMITS = {
  bytes: 25 * 1024 * 1024,
  perMessage: 10,
  fileName: 200,
  /** Bytes per transfer chunk between renderer and Agent Host. */
  chunk: 1024 * 1024
} as const;

export interface TeamChatAttachment {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  width?: number;
  height?: number;
}

/** Extensions the service accepts; anything else (executables included) is refused. */
export const TEAM_CHAT_ATTACHMENT_EXTENSIONS: readonly string[] = [
  "png", "jpg", "jpeg", "gif", "webp", "heic",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "key", "numbers", "pages",
  "csv", "tsv", "txt", "md", "json", "xml", "rtf",
  "zip", "7z", "rar", "tar", "gz", "tgz"
];

const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Shown inline in the timeline; other files (HEIC included) show as file cards. */
export function teamChatAttachmentIsInlineImage(attachment: Pick<TeamChatAttachment, "contentType">): boolean {
  return INLINE_IMAGE_TYPES.has(attachment.contentType);
}

export type TeamChatAttachmentRejection = "type" | "size" | "name";

/** Checks a file before asking the service, so obvious refusals cost no request. */
export function teamChatAttachmentRejection(file: { name: string; size: number }): TeamChatAttachmentRejection | undefined {
  const name = file.name.trim();
  if (!name || name.startsWith(".") || teamChatCodePointLength(name) > TEAM_CHAT_ATTACHMENT_LIMITS.fileName) return "name";
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!TEAM_CHAT_ATTACHMENT_EXTENSIONS.includes(extension)) return "type";
  if (file.size < 1 || file.size > TEAM_CHAT_ATTACHMENT_LIMITS.bytes) return "size";
  return undefined;
}
