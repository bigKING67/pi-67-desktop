import { create } from "zustand";
import type { ComposerReviewComment, ComposerWorkspaceFileRef, PromptStashItem } from "@pi67/domain";
import {
  MAX_COMPOSER_DRAFT_TEXT_BYTES,
  MAX_COMPOSER_REVIEW_COMMENTS,
  MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES,
  MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES_TOTAL,
  MAX_PROMPT_STASH_ITEMS,
  MAX_PROMPT_STASH_TEXT_BYTES_TOTAL
} from "@pi67/domain";
import {
  revokeDraftAttachments,
  type DraftAttachment
} from "../composer/composer-attachments.js";

const encoder = new TextEncoder();

export interface TaskDraft {
  text: string;
  attachments: DraftAttachment[];
  workspaceFiles: ComposerWorkspaceFileRef[];
  reviewComments: ComposerReviewComment[];
  promptStash: PromptStashItem[];
  streamBehavior: "steer" | "followUp";
  interactionMode: "execute" | "plan";
}

export const EMPTY_TASK_DRAFT: TaskDraft = {
  text: "",
  attachments: [],
  workspaceFiles: [],
  reviewComments: [],
  promptStash: [],
  streamBehavior: "followUp",
  interactionMode: "execute"
};

interface TaskDraftState {
  drafts: Record<string, TaskDraft>;
  setText: (taskId: string, text: string) => void;
  setAttachments: (taskId: string, attachments: DraftAttachment[]) => void;
  setWorkspaceFiles: (taskId: string, workspaceFiles: ComposerWorkspaceFileRef[]) => void;
  addReviewComment: (
    taskId: string,
    comment: ComposerReviewComment
  ) => "added" | "duplicate" | "full" | "too-large";
  removeReviewComments: (taskId: string, commentIds: readonly string[]) => void;
  addPromptStash: (
    taskId: string,
    item: PromptStashItem
  ) => "added" | "duplicate" | "full" | "too-large";
  removePromptStash: (taskId: string, itemId: string) => void;
  setStreamBehavior: (taskId: string, streamBehavior: TaskDraft["streamBehavior"]) => void;
  setInteractionMode: (taskId: string, interactionMode: TaskDraft["interactionMode"]) => void;
  restore: (
    taskId: string,
    draft: Pick<TaskDraft, "text" | "streamBehavior"> & Partial<Pick<TaskDraft, "interactionMode" | "workspaceFiles" | "reviewComments" | "promptStash">>
  ) => "restored" | "conflict";
  transfer: (sourceTaskId: string, targetTaskId: string) => "empty" | "moved" | "conflict";
  discard: (taskId: string) => void;
  dispose: () => void;
}

export const useTaskDraftStore = create<TaskDraftState>((set, get) => ({
  drafts: {},

  setText(taskId, text) {
    set((state) => ({
      drafts: { ...state.drafts, [taskId]: { ...draftFor(state, taskId), text } }
    }));
  },

  setAttachments(taskId, attachments) {
    set((state) => ({
      drafts: { ...state.drafts, [taskId]: { ...draftFor(state, taskId), attachments } }
    }));
  },

  setWorkspaceFiles(taskId, workspaceFiles) {
    set((state) => ({
      drafts: { ...state.drafts, [taskId]: { ...draftFor(state, taskId), workspaceFiles } }
    }));
  },

  addReviewComment(taskId, comment) {
    const current = draftFor(get(), taskId);
    if (current.reviewComments.some((candidate) => candidate.id === comment.id)) return "duplicate";
    if (current.reviewComments.length >= MAX_COMPOSER_REVIEW_COMMENTS) return "full";
    const bodyBytes = encoder.encode(comment.body).byteLength;
    const totalBytes = current.reviewComments.reduce(
      (total, candidate) => total + encoder.encode(candidate.body).byteLength,
      bodyBytes
    );
    if (
      comment.body.trim().length === 0
      || bodyBytes > MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES
      || totalBytes > MAX_COMPOSER_REVIEW_COMMENT_BODY_BYTES_TOTAL
    ) return "too-large";
    set((state) => ({
      drafts: {
        ...state.drafts,
        [taskId]: {
          ...draftFor(state, taskId),
          reviewComments: [...draftFor(state, taskId).reviewComments, cloneReviewComment(comment)]
        }
      }
    }));
    return "added";
  },

  removeReviewComments(taskId, commentIds) {
    if (commentIds.length === 0) return;
    const ids = new Set(commentIds);
    set((state) => ({
      drafts: {
        ...state.drafts,
        [taskId]: {
          ...draftFor(state, taskId),
          reviewComments: draftFor(state, taskId).reviewComments.filter((comment) => !ids.has(comment.id))
        }
      }
    }));
  },

  addPromptStash(taskId, item) {
    const current = draftFor(get(), taskId);
    if (
      (item.attachments?.length ?? 0) === 0
      && current.promptStash.some((candidate) => (
        (candidate.attachments?.length ?? 0) === 0 && candidate.text === item.text
      ))
    ) return "duplicate";
    if (current.promptStash.length >= MAX_PROMPT_STASH_ITEMS) return "full";
    const itemBytes = encoder.encode(item.text).byteLength;
    const totalBytes = current.promptStash.reduce(
      (total, candidate) => total + encoder.encode(candidate.text).byteLength,
      itemBytes
    );
    if (
      itemBytes > MAX_COMPOSER_DRAFT_TEXT_BYTES
      || totalBytes > MAX_PROMPT_STASH_TEXT_BYTES_TOTAL
    ) return "too-large";
    set((state) => ({
      drafts: {
        ...state.drafts,
        [taskId]: {
          ...draftFor(state, taskId),
          promptStash: [...draftFor(state, taskId).promptStash, cloneStashItem(item)]
        }
      }
    }));
    return "added";
  },

  removePromptStash(taskId, itemId) {
    set((state) => ({
      drafts: {
        ...state.drafts,
        [taskId]: {
          ...draftFor(state, taskId),
          promptStash: draftFor(state, taskId).promptStash.filter((item) => item.id !== itemId)
        }
      }
    }));
  },

  setStreamBehavior(taskId, streamBehavior) {
    set((state) => ({
      drafts: { ...state.drafts, [taskId]: { ...draftFor(state, taskId), streamBehavior } }
    }));
  },

  setInteractionMode(taskId, interactionMode) {
    set((state) => ({
      drafts: { ...state.drafts, [taskId]: { ...draftFor(state, taskId), interactionMode } }
    }));
  },

  restore(taskId, draft) {
    const current = get().drafts[taskId];
    // Any existing record represents a newer live-window mutation, including
    // clearing the text, whitespace-only input, or a stream-mode change.
    if (current) return "conflict";
    set((state) => ({
      drafts: {
        ...state.drafts,
        [taskId]: {
          text: draft.text,
          attachments: [],
          workspaceFiles: draft.workspaceFiles?.map((reference) => ({ ...reference })) ?? [],
          reviewComments: draft.reviewComments?.map(cloneReviewComment) ?? [],
          promptStash: draft.promptStash?.map(cloneStashItem) ?? [],
          streamBehavior: draft.streamBehavior,
          interactionMode: draft.interactionMode ?? "execute"
        }
      }
    }));
    return "restored";
  },

  transfer(sourceTaskId, targetTaskId) {
    if (sourceTaskId === targetTaskId) return "conflict";
    const current = get();
    const source = current.drafts[sourceTaskId];
    if (!source || !hasDraftContent(source)) return "empty";
    const target = current.drafts[targetTaskId];
    if (target && hasDraftContent(target)) return "conflict";
    const drafts = { ...current.drafts, [targetTaskId]: source };
    delete drafts[sourceTaskId];
    set({ drafts });
    return "moved";
  },

  discard(taskId) {
    const current = get();
    const draft = current.drafts[taskId];
    if (draft) revokeDraftAttachments(draft.attachments);
    const drafts = { ...current.drafts };
    delete drafts[taskId];
    set({ drafts });
  },

  dispose() {
    for (const draft of Object.values(get().drafts)) revokeDraftAttachments(draft.attachments);
    set({ drafts: {} });
  }
}));

function emptyTaskDraft(): TaskDraft {
  return { ...EMPTY_TASK_DRAFT, attachments: [], workspaceFiles: [], reviewComments: [], promptStash: [] };
}

function draftFor(state: TaskDraftState, taskId: string): TaskDraft {
  return state.drafts[taskId] ?? emptyTaskDraft();
}

function hasDraftContent(draft: TaskDraft): boolean {
  return draft.text.trim().length > 0
    || draft.attachments.length > 0
    || draft.workspaceFiles.length > 0
    || draft.reviewComments.length > 0
    || draft.promptStash.length > 0;
}

function cloneReviewComment(comment: ComposerReviewComment): ComposerReviewComment {
  return {
    ...comment,
    authority: { ...comment.authority },
    anchor: { ...comment.anchor },
    file: { ...comment.file }
  };
}

function cloneStashItem(item: PromptStashItem): PromptStashItem {
  return {
    ...item,
    ...(item.attachments ? { attachments: item.attachments.map((attachment) => ({ ...attachment })) } : {})
  };
}
