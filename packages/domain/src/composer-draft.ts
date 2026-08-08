import type { ConversationKey } from "./workbench.js";
import type { SessionInteractionMode } from "./plan-mode.js";

export const MAX_COMPOSER_DRAFTS = 200;
export const MAX_COMPOSER_DRAFT_TEXT_BYTES = 256 * 1024;
export const MAX_COMPOSER_DRAFT_TEXT_BYTES_TOTAL = 4 * 1024 * 1024;
export const MAX_COMPOSER_WORKSPACE_FILE_REFS = 64;
export const MAX_PROMPT_STASH_ITEMS = 20;
export const MAX_PROMPT_STASH_TEXT_BYTES_TOTAL = 2 * 1024 * 1024;

export type ComposerDraftEnvironmentIntent = "local" | "worktree";

export interface ComposerWorkspaceFileRef {
  id: string;
  revision: string;
  relativePath: string;
}

export interface PromptStashItem {
  id: string;
  text: string;
  createdAt: number;
}

export interface ComposerDraftRecord {
  conversation: ConversationKey;
  text: string;
  streamBehavior: "steer" | "followUp";
  updatedAt: number;
  workspaceFiles?: ComposerWorkspaceFileRef[];
  promptStash?: PromptStashItem[];
  environmentIntent?: ComposerDraftEnvironmentIntent;
  interactionMode?: SessionInteractionMode;
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
