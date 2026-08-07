import { create } from "zustand";
import {
  revokeDraftAttachments,
  type DraftAttachment
} from "../composer/composer-attachments.js";

export interface TaskDraft {
  text: string;
  attachments: DraftAttachment[];
  streamBehavior: "steer" | "followUp";
}

export const EMPTY_TASK_DRAFT: TaskDraft = {
  text: "",
  attachments: [],
  streamBehavior: "followUp"
};

interface TaskDraftState {
  drafts: Record<string, TaskDraft>;
  setText: (taskId: string, text: string) => void;
  setAttachments: (taskId: string, attachments: DraftAttachment[]) => void;
  setStreamBehavior: (taskId: string, streamBehavior: TaskDraft["streamBehavior"]) => void;
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

  setStreamBehavior(taskId, streamBehavior) {
    set((state) => ({
      drafts: { ...state.drafts, [taskId]: { ...draftFor(state, taskId), streamBehavior } }
    }));
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
  return { ...EMPTY_TASK_DRAFT, attachments: [] };
}

function draftFor(state: TaskDraftState, taskId: string): TaskDraft {
  return state.drafts[taskId] ?? emptyTaskDraft();
}

function hasDraftContent(draft: TaskDraft): boolean {
  return draft.text.trim().length > 0 || draft.attachments.length > 0;
}
