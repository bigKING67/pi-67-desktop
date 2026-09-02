import type { ConversationKey } from "./workbench.js";
import type { SessionInteractionMode } from "./plan-mode.js";

export const MAX_COMPOSER_DRAFTS = 200;
export const MAX_COMPOSER_DRAFT_TEXT_BYTES = 256 * 1024;
export const MAX_COMPOSER_DRAFT_TEXT_BYTES_TOTAL = 4 * 1024 * 1024;
export const MAX_COMPOSER_WORKSPACE_FILE_REFS = 64;
export const MAX_COMPOSER_REVIEW_COMMENTS = 64;
export const MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES = 16 * 1024;
export const MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES_TOTAL = 256 * 1024;
export const MAX_PROMPT_STASH_ITEMS = 20;
export const MAX_PROMPT_STASH_TEXT_BYTES_TOTAL = 2 * 1024 * 1024;
export const MAX_PROMPT_STASH_IMAGE_BYTES_PER_ITEM = 32 * 1024 * 1024;
export const MAX_PROMPT_STASH_IMAGE_BYTES_PER_TASK = 128 * 1024 * 1024;
export const MAX_PROMPT_STASH_IMAGE_BYTES_TOTAL = 512 * 1024 * 1024;

export type ComposerDraftEnvironmentIntent = "local" | "worktree";

export interface ComposerDraftModelSelection {
  provider: string;
  model: string;
}

export interface ComposerWorkspaceFileRef {
  id: string;
  revision: string;
  relativePath: string;
}

export type ChangeReviewPatchSection = "session" | "staged" | "unstaged";
export type ChangeReviewSide = "old" | "new";

export interface ChangeReviewAnchor {
  section: ChangeReviewPatchSection;
  side: ChangeReviewSide;
  startLine: number;
  endLine: number;
}

export type ChangeReviewAuthority =
  | {
      source: "session";
      workspaceId: string;
      sessionFileIdentity: string;
      toolCallId: string;
      contentFingerprint: string;
    }
  | {
      source: "worktree";
      workspaceId: string;
      revision: number;
      changeId: string;
      contentFingerprint: string;
    };

export interface ComposerReviewComment {
  id: string;
  authority: ChangeReviewAuthority;
  anchor: ChangeReviewAnchor;
  body: string;
  createdAt: number;
  file: ComposerWorkspaceFileRef;
}

export interface PromptStashItem {
  id: string;
  text: string;
  createdAt: number;
  attachments?: PromptStashImageRef[];
}

export interface PromptStashImageRef {
  blobId: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  byteLength: number;
  kind: "image";
}

export interface ComposerDraftRecord {
  conversation: ConversationKey;
  text: string;
  streamBehavior: "steer" | "followUp";
  updatedAt: number;
  workspaceFiles?: ComposerWorkspaceFileRef[];
  reviewComments?: ComposerReviewComment[];
  promptStash?: PromptStashItem[];
  environmentIntent?: ComposerDraftEnvironmentIntent;
  interactionMode?: SessionInteractionMode;
  startupModel?: ComposerDraftModelSelection;
  startupThinkingLevel?: string;
}

export interface ComposerDraftPersistedState {
  version: 1;
  drafts: ComposerDraftRecord[];
  selectedConversation?: ConversationKey;
}

export interface ComposerDraftStateSnapshot {
  state: ComposerDraftPersistedState;
  persistence: "available" | "unavailable";
  recovery?: "backup-restored" | "corrupt-reset" | "draft-decrypt-failed";
}
