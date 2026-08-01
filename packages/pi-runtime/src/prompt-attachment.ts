import type { PromptAttachmentKind, PromptAttachmentRef } from "@pi67/protocol";

export const DESKTOP_ATTACHMENT_CUSTOM_MESSAGE = "pi67.desktop-attachments.v1";

export interface PreparedPromptAttachment {
  id: string;
  name: string;
  mimeType: string;
  byteLength: number;
  kind: PromptAttachmentKind;
}

export interface PreparedPromptAttachmentSet {
  id: string;
  attachments: readonly PreparedPromptAttachment[];
}

export interface PreparedPromptImage {
  type: "image";
  data: string;
  mimeType: string;
}

export type PromptAttachmentReadOperation =
  | "list"
  | "metadata"
  | "read_text"
  | "search"
  | "strings"
  | "read_bytes"
  | "list_archive"
  | "read_archive_entry";

export interface PromptAttachmentReadRequest {
  setId: string;
  operation: PromptAttachmentReadOperation;
  attachmentId?: string;
  query?: string;
  offset?: number;
  length?: number;
  entry?: string;
}

export interface PromptAttachmentReadResult {
  text: string;
  details: {
    operation: PromptAttachmentReadOperation;
    setId: string;
    attachmentId?: string;
    truncated: boolean;
  };
}

export interface PromptAttachmentAccess {
  claim(
    submissionId: string,
    refs: readonly PromptAttachmentRef[]
  ): Promise<PreparedPromptAttachmentSet | undefined>;
  readImages(setId: string): Promise<PreparedPromptImage[]>;
  read(request: PromptAttachmentReadRequest, signal?: AbortSignal): Promise<PromptAttachmentReadResult>;
}

export function promptAttachmentMessage(set: PreparedPromptAttachmentSet): {
  customType: typeof DESKTOP_ATTACHMENT_CUSTOM_MESSAGE;
  content: string;
  display: false;
  details: PreparedPromptAttachmentSet;
} {
  return {
    customType: DESKTOP_ATTACHMENT_CUSTOM_MESSAGE,
    content: [
      `The user attached ${set.attachments.length} file(s) for this turn.`,
      `Use read_attachment with setId ${set.id} to inspect ordinary files.`,
      "Do not guess local paths or claim to have read a file before the tool returns its content."
    ].join(" "),
    display: false,
    details: set
  };
}
