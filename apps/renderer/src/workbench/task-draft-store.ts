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
