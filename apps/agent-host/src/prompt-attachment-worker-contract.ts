import type {
  PreparedPromptAttachment,
  PromptAttachmentReadOperation
} from "@pi67/pi-runtime";

export interface PromptAttachmentWorkerTask {
  id: string;
  bytes: ArrayBuffer;
  attachment: PreparedPromptAttachment;
  operation: PromptAttachmentReadOperation;
  query?: string;
  offset?: number;
  length?: number;
  entry?: string;
  ocrDataRoot: string;
}

export type PromptAttachmentWorkerResponse =
  | { id: string; ok: true; text: string; truncated: boolean }
  | { id: string; ok: false; error: string };
