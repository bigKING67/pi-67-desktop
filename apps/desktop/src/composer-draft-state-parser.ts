import { isAbsolute } from "node:path";
import {
  MAX_COMPOSER_DRAFTS,
  MAX_COMPOSER_DRAFT_TEXT_BYTES,
  MAX_COMPOSER_DRAFT_TEXT_BYTES_TOTAL,
  MAX_COMPOSER_REVIEW_COMMENTS,
  MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES,
  MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES_TOTAL,
  MAX_COMPOSER_WORKSPACE_FILE_REFS,
  MAX_PROMPT_STASH_ITEMS,
  MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM,
  MAX_PROMPT_STASH_IMAGE_BYTES_PER_TASK,
  MAX_PROMPT_STASH_IMAGE_BYTES_TOTAL,
  MAX_PROMPT_STASH_TEXT_BYTES_TOTAL,
  MAX_WORKSPACE_FILE_PATH_CHARS,
  type ComposerDraftPersistedState,
  type ComposerDraftRecord
} from "@pi67/protocol";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";
import { isBoundedSessionFileIdentity } from "./workbench-state-value-contract.js";

export const MAX_STORED_COMPOSER_DRAFT_STATE_BYTES = 8 * 1024 * 1024;
const MAX_ID_CHARS = 1_024;
const MAX_DRAFT_ID_CHARS = 200;
const MAX_SESSION_PATH_CHARS = 32_768;
const MAX_RUNTIME_IDENTIFIER_CHARS = 512;
const MAX_THINKING_LEVEL_CHARS = 64;
export interface StoredComposerDraftState {
  version: 1;
  encryptedState?: string;
  emptyState?: true;
}

export function parseComposerDraftPersistedState(value: unknown): ComposerDraftPersistedState | undefined {
  if (!isRecordWithAllowedKeys(value, ["version", "drafts", "selectedConversation"], ["version", "drafts"])) {
    return undefined;
  }
  if (value.version !== 1 || !Array.isArray(value.drafts) || value.drafts.length > MAX_COMPOSER_DRAFTS) {
    return undefined;
  }
  const drafts: ComposerDraftRecord[] = [];
  const identities = new Set<string>();
  let totalTextBytes = 0;
  let totalPromptStashBytes = 0;
  let totalPromptStashImageBytes = 0;
  for (const candidate of value.drafts) {
    if (!isRecordWithAllowedKeys(
      candidate,
      [
        "conversation", "text", "streamBehavior", "updatedAt", "workspaceFiles", "reviewComments",
        "promptStash", "environmentIntent", "interactionMode", "startupModel", "startupThinkingLevel"
      ],
      ["conversation", "text", "streamBehavior", "updatedAt"]
    )) return undefined;
    const conversation = parseConversation(candidate.conversation);
    if (!conversation || typeof candidate.text !== "string") return undefined;
    const workspaceFiles = parseWorkspaceFileReferences(candidate.workspaceFiles);
    if (candidate.workspaceFiles !== undefined && !workspaceFiles) return undefined;
    const reviewComments = parseReviewComments(candidate.reviewComments);
    if (candidate.reviewComments !== undefined && !reviewComments) return undefined;
    const promptStash = parsePromptStash(candidate.promptStash);
    if (candidate.promptStash !== undefined && !promptStash) return undefined;
    const startupModel = parseStartupModel(candidate.startupModel);
    if (candidate.startupModel !== undefined && !startupModel) return undefined;
    const startupThinkingLevel = candidate.startupThinkingLevel;
    if (startupThinkingLevel !== undefined
      && !isBoundedString(startupThinkingLevel, MAX_THINKING_LEVEL_CHARS)) return undefined;
    if (
      candidate.text.length === 0
      && !reviewComments?.length
      && !promptStash?.length
      && !startupModel
      && !startupThinkingLevel
    ) return undefined;
    const textBytes = Buffer.byteLength(candidate.text, "utf8");
    const reviewBytes = (reviewComments ?? []).reduce(
      (total, comment) => total + Buffer.byteLength(comment.body, "utf8"),
      0
    );
    const stashBytes = (promptStash ?? []).reduce((total, item) => total + Buffer.byteLength(item.text, "utf8"), 0);
    const stashImageBytes = (promptStash ?? []).reduce(
      (total, item) => total + (item.attachments ?? []).reduce((sum, image) => sum + image.byteLength, 0),
      0
    );
    totalTextBytes += textBytes + reviewBytes + stashBytes;
    totalPromptStashBytes += stashBytes;
    totalPromptStashImageBytes += stashImageBytes;
    if (
      textBytes > MAX_COMPOSER_DRAFT_TEXT_BYTES
      || totalTextBytes > MAX_COMPOSER_DRAFT_TEXT_BYTES_TOTAL
      || totalPromptStashBytes > MAX_PROMPT_STASH_TEXT_BYTES_TOTAL
      || stashImageBytes > MAX_PROMPT_STASH_IMAGE_BYTES_PER_TASK
      || totalPromptStashImageBytes > MAX_PROMPT_STASH_IMAGE_BYTES_TOTAL
      || (candidate.streamBehavior !== "steer" && candidate.streamBehavior !== "followUp")
      || (
        candidate.environmentIntent !== undefined
        && candidate.environmentIntent !== "local"
        && candidate.environmentIntent !== "worktree"
      )
      || (candidate.environmentIntent !== undefined && conversation.kind !== "provisional")
      || (
        candidate.interactionMode !== undefined
        && candidate.interactionMode !== "execute"
        && candidate.interactionMode !== "plan"
      )
      || (candidate.interactionMode !== undefined && conversation.kind !== "provisional")
      || (candidate.startupModel !== undefined && conversation.kind !== "provisional")
      || (candidate.startupThinkingLevel !== undefined && conversation.kind !== "provisional")
      || !Number.isSafeInteger(candidate.updatedAt)
      || Number(candidate.updatedAt) < 0
    ) return undefined;
    const identity = conversationIdentity(conversation);
    if (identities.has(identity)) return undefined;
    identities.add(identity);
    drafts.push({
      conversation,
      text: candidate.text,
      streamBehavior: candidate.streamBehavior,
      updatedAt: Number(candidate.updatedAt),
      ...(workspaceFiles?.length ? { workspaceFiles } : {}),
      ...(reviewComments?.length ? { reviewComments } : {}),
      ...(promptStash?.length ? { promptStash } : {}),
      ...(candidate.environmentIntent ? { environmentIntent: candidate.environmentIntent } : {}),
      ...(candidate.interactionMode ? { interactionMode: candidate.interactionMode } : {}),
      ...(startupModel ? { startupModel } : {}),
      ...(startupThinkingLevel ? { startupThinkingLevel } : {})
    });
  }
  const selectedConversation = value.selectedConversation === undefined
    ? undefined
    : parseConversation(value.selectedConversation);
  if (value.selectedConversation !== undefined && !selectedConversation) return undefined;
  if (selectedConversation && !identities.has(conversationIdentity(selectedConversation))) return undefined;
  return {
    version: 1,
    drafts,
    ...(selectedConversation ? { selectedConversation } : {})
  };
}

function parseStartupModel(value: unknown): ComposerDraftRecord["startupModel"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !hasExactKeys(value, ["provider", "model"])) return undefined;
  if (
    !isBoundedString(value.provider, MAX_RUNTIME_IDENTIFIER_CHARS)
    || !isBoundedString(value.model, MAX_RUNTIME_IDENTIFIER_CHARS)
  ) return undefined;
  return { provider: value.provider, model: value.model };
}

export function parseStoredComposerDraftState(value: unknown): StoredComposerDraftState | undefined {
  if (
    !isRecordWithAllowedKeys(value, ["version", "encryptedState", "emptyState"], ["version"])
    || value.version !== 1
    || (value.emptyState !== undefined && value.emptyState !== true)
    || (value.emptyState === true && value.encryptedState !== undefined)
  ) {
    return undefined;
  }
  if (value.emptyState === true) return { version: 1, emptyState: true };
  if (value.encryptedState === undefined) return { version: 1 };
  if (
    typeof value.encryptedState !== "string"
    || value.encryptedState.length === 0
    || value.encryptedState.length > MAX_STORED_COMPOSER_DRAFT_STATE_BYTES
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.encryptedState)
  ) return undefined;
  return { version: 1, encryptedState: value.encryptedState };
}

export function encodeStoredComposerDraftState(
  state: ComposerDraftPersistedState,
  encryption: DesktopTextEncryption
): StoredComposerDraftState {
  if (state.drafts.length === 0) return { version: 1, emptyState: true };
  if (!encryption.isAvailable()) return { version: 1 };
  return {
    version: 1,
    encryptedState: encryption.encrypt(JSON.stringify(state)).toString("base64")
  };
}

export function emptyComposerDraftState(): ComposerDraftPersistedState {
  return { version: 1, drafts: [] };
}

function parseReviewComments(value: unknown): ComposerDraftRecord["reviewComments"] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_COMPOSER_REVIEW_COMMENTS) return undefined;
  const comments: NonNullable<ComposerDraftRecord["reviewComments"]> = [];
  const ids = new Set<string>();
  let totalBodyBytes = 0;
  for (const candidate of value) {
    if (!isRecord(candidate) || !hasExactKeys(
      candidate,
      ["id", "authority", "anchor", "body", "createdAt", "file"]
    )) return undefined;
    const authority = parseReviewAuthority(candidate.authority);
    const anchor = parseReviewAnchor(candidate.anchor);
    const file = parseWorkspaceFileReferences([candidate.file])?.[0];
    const bodyBytes = typeof candidate.body === "string"
      ? Buffer.byteLength(candidate.body, "utf8")
      : Number.POSITIVE_INFINITY;
    totalBodyBytes += bodyBytes;
    if (
      !isOpaqueFileToken(candidate.id)
      || ids.has(candidate.id)
      || !authority
      || !anchor
      || !file
      || typeof candidate.body !== "string"
      || candidate.body.trim().length === 0
      || bodyBytes > MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES
      || totalBodyBytes > MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES_TOTAL
      || !Number.isSafeInteger(candidate.createdAt)
      || Number(candidate.createdAt) < 0
    ) return undefined;
    ids.add(candidate.id);
    comments.push({
      id: candidate.id,
      authority,
      anchor,
      body: candidate.body,
      createdAt: Number(candidate.createdAt),
      file
    });
  }
  return comments;
}

function parseReviewAuthority(
  value: unknown
): NonNullable<ComposerDraftRecord["reviewComments"]>[number]["authority"] | undefined {
  if (!isRecord(value) || !isBoundedString(value.workspaceId, MAX_ID_CHARS)) return undefined;
  if (
    value.source === "session"
    && hasExactKeys(
      value,
      ["source", "workspaceId", "sessionFileIdentity", "toolCallId", "contentFingerprint"]
    )
    && isBoundedSessionFileIdentity(value.sessionFileIdentity)
    && isBoundedString(value.toolCallId, 512)
    && isBoundedString(value.contentFingerprint, 512)
  ) return {
    source: "session",
    workspaceId: value.workspaceId,
    sessionFileIdentity: value.sessionFileIdentity,
    toolCallId: value.toolCallId,
    contentFingerprint: value.contentFingerprint
  };
  if (
    value.source === "worktree"
    && hasExactKeys(value, ["source", "workspaceId", "revision", "changeId", "contentFingerprint"])
    && Number.isSafeInteger(value.revision)
    && Number(value.revision) >= 0
    && isBoundedString(value.changeId, 512)
    && isBoundedString(value.contentFingerprint, 512)
  ) return {
    source: "worktree",
    workspaceId: value.workspaceId,
    revision: Number(value.revision),
    changeId: value.changeId,
    contentFingerprint: value.contentFingerprint
  };
  return undefined;
}

function parseReviewAnchor(
  value: unknown
): NonNullable<ComposerDraftRecord["reviewComments"]>[number]["anchor"] | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["section", "side", "startLine", "endLine"])) {
    return undefined;
  }
  if (
    value.section !== "session" && value.section !== "staged" && value.section !== "unstaged"
  ) return undefined;
  if (value.side !== "old" && value.side !== "new") return undefined;
  if (
    !Number.isSafeInteger(value.startLine)
    || !Number.isSafeInteger(value.endLine)
    || Number(value.startLine) < 1
    || Number(value.endLine) < Number(value.startLine)
  ) return undefined;
  return {
    section: value.section,
    side: value.side,
    startLine: Number(value.startLine),
    endLine: Number(value.endLine)
  };
}

function parsePromptStash(value: unknown): ComposerDraftRecord["promptStash"] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PROMPT_STASH_ITEMS) return undefined;
  const items: NonNullable<ComposerDraftRecord["promptStash"]> = [];
  const ids = new Set<string>();
  let totalBytes = 0;
  let totalImageBytes = 0;
  for (const candidate of value) {
    if (
      !isRecordWithAllowedKeys(candidate, ["id", "text", "createdAt", "attachments"], ["id", "text", "createdAt"])
    ) return undefined;
    const attachments = parsePromptStashImages(candidate.attachments);
    if (candidate.attachments !== undefined && !attachments) return undefined;
    if (
      !isOpaqueFileToken(candidate.id)
      || typeof candidate.text !== "string"
      || (candidate.text.trim().length === 0 && (attachments?.length ?? 0) === 0)
      || !Number.isSafeInteger(candidate.createdAt)
      || Number(candidate.createdAt) < 0
      || ids.has(candidate.id)
    ) return undefined;
    totalBytes += Buffer.byteLength(candidate.text, "utf8");
    const itemImageBytes = (attachments ?? []).reduce((total, image) => total + image.byteLength, 0);
    totalImageBytes += itemImageBytes;
    if (
      Buffer.byteLength(candidate.text, "utf8") > MAX_COMPOSER_DRAFT_TEXT_BYTES
      || totalBytes > MAX_PROMPT_STASH_TEXT_BYTES_TOTAL
      || itemImageBytes > MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM
      || totalImageBytes > MAX_PROMPT_STASH_IMAGE_BYTES_PER_TASK
    ) return undefined;
    ids.add(candidate.id);
    items.push({
      id: candidate.id,
      text: candidate.text,
      createdAt: Number(candidate.createdAt),
      ...(attachments?.length ? { attachments } : {})
    });
  }
  return items;
}

function parsePromptStashImages(
  value: unknown
): NonNullable<NonNullable<ComposerDraftRecord["promptStash"]>[number]["attachments"]> | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return undefined;
  const images: NonNullable<NonNullable<ComposerDraftRecord["promptStash"]>[number]["attachments"]> = [];
  const ids = new Set<string>();
  let bytes = 0;
  for (const candidate of value) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["blobId", "name", "mimeType", "byteLength", "kind"])) {
      return undefined;
    }
    if (
      !isOpaqueFileToken(candidate.blobId)
      || ids.has(candidate.blobId)
      || typeof candidate.name !== "string"
      || candidate.name.length === 0
      || candidate.name.length > 1_024
      || candidate.name.includes("/")
      || candidate.name.includes("\\")
      || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(String(candidate.mimeType))
      || !Number.isSafeInteger(candidate.byteLength)
      || Number(candidate.byteLength) < 0
      || candidate.kind !== "image"
    ) return undefined;
    bytes += Number(candidate.byteLength);
    if (bytes > MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM) return undefined;
    ids.add(candidate.blobId);
    images.push({
      blobId: candidate.blobId,
      name: candidate.name,
      mimeType: candidate.mimeType as (typeof images)[number]["mimeType"],
      byteLength: Number(candidate.byteLength),
      kind: "image"
    });
  }
  return images;
}

function parseWorkspaceFileReferences(value: unknown): ComposerDraftRecord["workspaceFiles"] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_COMPOSER_WORKSPACE_FILE_REFS) return undefined;
  const references: NonNullable<ComposerDraftRecord["workspaceFiles"]> = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["id", "revision", "relativePath"])) return undefined;
    if (
      !isOpaqueFileToken(candidate.id)
      || !isOpaqueFileToken(candidate.revision)
      || typeof candidate.relativePath !== "string"
      || candidate.relativePath.length === 0
      || candidate.relativePath.length > MAX_WORKSPACE_FILE_PATH_CHARS
      || candidate.relativePath.includes("\0")
      || ids.has(candidate.id)
    ) return undefined;
    ids.add(candidate.id);
    references.push({
      id: candidate.id,
      revision: candidate.revision,
      relativePath: candidate.relativePath
    });
  }
  return references;
}

function parseConversation(value: unknown): ComposerDraftRecord["conversation"] | undefined {
  if (!isRecord(value) || !isBoundedString(value.workspaceId, MAX_ID_CHARS)) return undefined;
  if (
    value.kind === "provisional"
    && hasExactKeys(value, ["kind", "workspaceId", "draftId"])
    && isBoundedString(value.draftId, MAX_DRAFT_ID_CHARS)
  ) return { kind: "provisional", workspaceId: value.workspaceId, draftId: value.draftId };
  if (
    value.kind === "session"
    && hasExactKeys(value, ["kind", "workspaceId", "sessionFileIdentity", "sessionPath"])
    && isBoundedSessionFileIdentity(value.sessionFileIdentity)
    && typeof value.sessionPath === "string"
    && value.sessionPath.length > 0
    && value.sessionPath.length <= MAX_SESSION_PATH_CHARS
    && !value.sessionPath.includes("\0")
    && isAbsolute(value.sessionPath)
  ) {
    return {
      kind: "session",
      workspaceId: value.workspaceId,
      sessionFileIdentity: value.sessionFileIdentity,
      sessionPath: value.sessionPath
    };
  }
  return undefined;
}

function conversationIdentity(conversation: ComposerDraftRecord["conversation"]): string {
  return conversation.kind === "session"
    ? `session:${conversation.workspaceId}:${conversation.sessionFileIdentity}`
    : `provisional:${conversation.workspaceId}:${conversation.draftId}`;
}

function isOpaqueFileToken(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordWithAllowedKeys(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0");
}
