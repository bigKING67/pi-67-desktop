import type { ComposerWorkspaceFileRef } from "@pi67/domain";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import type { DraftAttachment } from "./composer-attachments.js";

export function composerDraftActions(taskId: string | undefined) {
  return {
    setText: (value: string): void => {
      if (taskId) useTaskDraftStore.getState().setText(taskId, value);
    },
    setAttachments: (
      value: DraftAttachment[] | ((current: DraftAttachment[]) => DraftAttachment[])
    ): void => {
      if (!taskId) return;
      const store = useTaskDraftStore.getState();
      const current = store.drafts[taskId]?.attachments ?? [];
      store.setAttachments(taskId, typeof value === "function" ? value(current) : value);
    },
    setWorkspaceFiles: (
      value: ComposerWorkspaceFileRef[]
        | ((current: ComposerWorkspaceFileRef[]) => ComposerWorkspaceFileRef[])
    ): void => {
      if (!taskId) return;
      const store = useTaskDraftStore.getState();
      const current = store.drafts[taskId]?.workspaceFiles ?? [];
      store.setWorkspaceFiles(taskId, typeof value === "function" ? value(current) : value);
    },
    setStreamBehavior: (value: "steer" | "followUp"): void => {
      if (taskId) useTaskDraftStore.getState().setStreamBehavior(taskId, value);
    }
  };
}
