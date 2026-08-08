import { persistTaskDraftStateAcknowledged } from "../workbench/task-draft-persistence.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";

export type PromptStashResult =
  | { status: "stashed" }
  | { status: "restored"; text: string }
  | {
      status:
        | "empty"
        | "full"
        | "too-large"
        | "file-references"
        | "conflict"
        | "missing"
        | "persistence-failed";
    };

export async function stashComposerPrompt(taskId: string): Promise<PromptStashResult> {
  const draft = useTaskDraftStore.getState().drafts[taskId];
  const sourceText = draft?.text ?? "";
  if (!sourceText.trim()) return { status: "empty" };
  if ((draft?.workspaceFiles.length ?? 0) > 0) return { status: "file-references" };

  const item = { id: crypto.randomUUID(), text: sourceText, createdAt: Date.now() };
  const admission = useTaskDraftStore.getState().addPromptStash(taskId, item);
  if (admission === "full") return { status: "full" };
  if (admission === "too-large") return { status: "too-large" };
  if (!await persistTaskDraftStateAcknowledged(taskId)) {
    if (admission === "added") useTaskDraftStore.getState().removePromptStash(taskId, item.id);
    return { status: "persistence-failed" };
  }

  const current = useTaskDraftStore.getState().drafts[taskId];
  if (current?.text !== sourceText) return { status: "stashed" };
  useTaskDraftStore.getState().setText(taskId, "");
  if (!await persistTaskDraftStateAcknowledged(taskId)) {
    if (useTaskDraftStore.getState().drafts[taskId]?.text === "") {
      useTaskDraftStore.getState().setText(taskId, sourceText);
    }
    return { status: "persistence-failed" };
  }
  return { status: "stashed" };
}

export async function restoreComposerPromptStash(
  taskId: string,
  itemId: string
): Promise<PromptStashResult> {
  const draft = useTaskDraftStore.getState().drafts[taskId];
  if (!draft) return { status: "missing" };
  if (draft.text.trim() || draft.workspaceFiles.length > 0) return { status: "conflict" };
  const item = draft.promptStash.find((candidate) => candidate.id === itemId);
  if (!item) return { status: "missing" };

  useTaskDraftStore.getState().setText(taskId, item.text);
  if (!await persistTaskDraftStateAcknowledged(taskId)) return { status: "persistence-failed" };
  useTaskDraftStore.getState().removePromptStash(taskId, itemId);
  if (!await persistTaskDraftStateAcknowledged(taskId)) {
    useTaskDraftStore.getState().addPromptStash(taskId, item);
    return { status: "persistence-failed" };
  }
  return { status: "restored", text: item.text };
}
