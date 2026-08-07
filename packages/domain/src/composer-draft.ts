import type { ConversationKey } from "./workbench.js";

export const MAX_COMPOSER_DRAFTS = 200;
export const MAX_COMPOSER_DRAFT_TEXT_BYTES = 256 * 1024;
export const MAX_COMPOSER_DRAFT_TEXT_BYTES_TOTAL = 4 * 1024 * 1024;

export interface ComposerDraftRecord {
  conversation: ConversationKey;
  text: string;
  streamBehavior: "steer" | "followUp";
  updatedAt: number;
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
