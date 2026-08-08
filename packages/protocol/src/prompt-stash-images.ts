import {
  MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM,
  type PromptStashImageRef
} from "@pi67/domain";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_PROMPT_ATTACHMENT_COUNT,
  MAX_PROMPT_ATTACHMENT_NAME_CHARS,
  type StagedPromptAttachment
} from "./agent-messages.js";

export interface PromptStashImagesStoreRequest {
  workspaceId: string;
  taskId: string;
  itemId: string;
  attachmentIds: string[];
}

export interface PromptStashImagesRestoreRequest {
  taskId: string;
  itemId: string;
}

export type PromptStashImagesDeleteRequest = PromptStashImagesRestoreRequest;

export interface PromptStashImagesStoreResult {
  itemId: string;
  attachments: PromptStashImageRef[];
}

export interface PromptStashImagesRestoreResult {
  itemId: string;
  attachments: StagedPromptAttachment[];
}

const IMAGE_MIME_TYPES = new Set<string>(ALLOWED_IMAGE_MIME_TYPES);

export function parsePromptStashImagesStoreRequest(value: unknown): PromptStashImagesStoreRequest | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["workspaceId", "taskId", "itemId", "attachmentIds"])) return undefined;
  if (!isOpaqueId(value.workspaceId) || !isOpaqueId(value.taskId) || !isOpaqueId(value.itemId)) return undefined;
  if (
    !Array.isArray(value.attachmentIds)
    || value.attachmentIds.length === 0
    || value.attachmentIds.length > MAX_PROMPT_ATTACHMENT_COUNT
    || value.attachmentIds.some((id) => !isOpaqueId(id))
    || new Set(value.attachmentIds).size !== value.attachmentIds.length
  ) return undefined;
  return {
    workspaceId: value.workspaceId,
    taskId: value.taskId,
    itemId: value.itemId,
    attachmentIds: [...value.attachmentIds]
  };
}

export function parsePromptStashImagesRestoreRequest(value: unknown): PromptStashImagesRestoreRequest | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["taskId", "itemId"])) return undefined;
  if (!isOpaqueId(value.taskId) || !isOpaqueId(value.itemId)) return undefined;
  return { taskId: value.taskId, itemId: value.itemId };
}

export function isPromptStashImagesStoreResult(value: unknown): value is PromptStashImagesStoreResult {
  return isRecord(value)
    && hasExactKeys(value, ["itemId", "attachments"])
    && isOpaqueId(value.itemId)
    && Array.isArray(value.attachments)
    && value.attachments.length > 0
    && value.attachments.length <= MAX_PROMPT_ATTACHMENT_COUNT
    && value.attachments.every(isStashImageRef)
    && new Set(value.attachments.map((item) => item.blobId)).size === value.attachments.length
    && value.attachments.reduce((total, item) => total + item.byteLength, 0) <= MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM;
}

export function isPromptStashImagesRestoreResult(value: unknown): value is PromptStashImagesRestoreResult {
  return isRecord(value)
    && hasExactKeys(value, ["itemId", "attachments"])
    && isOpaqueId(value.itemId)
    && Array.isArray(value.attachments)
    && value.attachments.length > 0
    && value.attachments.length <= MAX_PROMPT_ATTACHMENT_COUNT
    && value.attachments.every(isStagedImage)
    && new Set(value.attachments.map((item) => item.id)).size === value.attachments.length;
}

function isStashImageRef(value: unknown): value is PromptStashImageRef {
  return isRecord(value)
    && hasExactKeys(value, ["blobId", "name", "mimeType", "byteLength", "kind"])
    && isOpaqueId(value.blobId)
    && isImageMetadata(value);
}

function isStagedImage(value: unknown): value is StagedPromptAttachment {
  return isRecord(value)
    && hasExactKeys(value, ["id", "name", "mimeType", "byteLength", "kind"])
    && isOpaqueId(value.id)
    && isImageMetadata(value);
}

function isImageMetadata(value: Record<string, unknown>): boolean {
  return typeof value.name === "string"
    && value.name.length > 0
    && value.name.length <= MAX_PROMPT_ATTACHMENT_NAME_CHARS
    && !value.name.includes("/")
    && !value.name.includes("\\")
    && IMAGE_MIME_TYPES.has(String(value.mimeType))
    && Number.isSafeInteger(value.byteLength)
    && Number(value.byteLength) >= 0
    && Number(value.byteLength) <= MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM
    && value.kind === "image";
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
