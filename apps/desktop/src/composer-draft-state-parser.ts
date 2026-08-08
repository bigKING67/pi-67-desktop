import { isAbsolute } from "node:path";
import {
  MAX_COMPOSER_DRAFTS,
  MAX_COMPOSER_DRAFT_TEXT_BYTES,
  MAX_COMPOSER_DRAFT_TEXT_BYTES_TOTAL,
  MAX_COMPOSER_WORKSPACE_FILE_REFS,
  MAX_PROMPT_STASH_ITEMS,
  MAX_PROMPT_STASH_TEXT_BYTES_TOTAL,
  MAX_WORKSPACE_FILE_PATH_CHARS,
  type ComposerDraftPersistedState,
  type ComposerDraftRecord
} from "@pi67/protocol";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";

export const MAX_STORED_COMPOSER_DRAFT_STATE_BYTES = 8 * 1024 * 1024;
const MAX_ID_CHARS = 1_024;
const MAX_DRAFT_ID_CHARS = 200;
const MAX_SESSION_FILE_IDENTITY_CHARS = 32_832;
const MAX_SESSION_PATH_CHARS = 32_768;

export interface StoredComposerDraftState {
  version: 1;
  encryptedState?: string;
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
  for (const candidate of value.drafts) {
    if (!isRecordWithAllowedKeys(
      candidate,
      ["conversation", "text", "streamBehavior", "updatedAt", "workspaceFiles", "promptStash", "environmentIntent", "interactionMode"],
      ["conversation", "text", "streamBehavior", "updatedAt"]
    )) return undefined;
    const conversation = parseConversation(candidate.conversation);
    if (!conversation || typeof candidate.text !== "string") return undefined;
    const workspaceFiles = parseWorkspaceFileReferences(candidate.workspaceFiles);
    if (candidate.workspaceFiles !== undefined && !workspaceFiles) return undefined;
    const promptStash = parsePromptStash(candidate.promptStash);
    if (candidate.promptStash !== undefined && !promptStash) return undefined;
    if (candidate.text.length === 0 && !promptStash?.length) return undefined;
    const textBytes = Buffer.byteLength(candidate.text, "utf8");
    const stashBytes = (promptStash ?? []).reduce((total, item) => total + Buffer.byteLength(item.text, "utf8"), 0);
    totalTextBytes += textBytes + stashBytes;
    totalPromptStashBytes += stashBytes;
    if (
      textBytes > MAX_COMPOSER_DRAFT_TEXT_BYTES
      || totalTextBytes > MAX_COMPOSER_DRAFT_TEXT_BYTES_TOTAL
      || totalPromptStashBytes > MAX_PROMPT_STASH_TEXT_BYTES_TOTAL
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
      ...(promptStash?.length ? { promptStash } : {}),
      ...(candidate.environmentIntent ? { environmentIntent: candidate.environmentIntent } : {}),
      ...(candidate.interactionMode ? { interactionMode: candidate.interactionMode } : {})
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

export function parseStoredComposerDraftState(value: unknown): StoredComposerDraftState | undefined {
  if (!isRecordWithAllowedKeys(value, ["version", "encryptedState"], ["version"]) || value.version !== 1) {
    return undefined;
  }
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
  if (!encryption.isAvailable()) return { version: 1 };
  return {
    version: 1,
    encryptedState: encryption.encrypt(JSON.stringify(state)).toString("base64")
  };
}

export function emptyComposerDraftState(): ComposerDraftPersistedState {
  return { version: 1, drafts: [] };
}

function parsePromptStash(value: unknown): ComposerDraftRecord["promptStash"] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PROMPT_STASH_ITEMS) return undefined;
  const items: NonNullable<ComposerDraftRecord["promptStash"]> = [];
  const ids = new Set<string>();
  let totalBytes = 0;
  for (const candidate of value) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["id", "text", "createdAt"])) return undefined;
    if (
      !isOpaqueFileToken(candidate.id)
      || typeof candidate.text !== "string"
      || candidate.text.trim().length === 0
      || !Number.isSafeInteger(candidate.createdAt)
      || Number(candidate.createdAt) < 0
      || ids.has(candidate.id)
    ) return undefined;
    totalBytes += Buffer.byteLength(candidate.text, "utf8");
    if (
      Buffer.byteLength(candidate.text, "utf8") > MAX_COMPOSER_DRAFT_TEXT_BYTES
      || totalBytes > MAX_PROMPT_STASH_TEXT_BYTES_TOTAL
    ) return undefined;
    ids.add(candidate.id);
    items.push({ id: candidate.id, text: candidate.text, createdAt: Number(candidate.createdAt) });
  }
  return items;
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
    && isBoundedString(value.sessionFileIdentity, MAX_SESSION_FILE_IDENTITY_CHARS)
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
