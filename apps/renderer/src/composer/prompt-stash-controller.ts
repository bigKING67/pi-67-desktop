import type { PromptStashImageRef, PromptStashItem } from "@pi67/domain";
import { persistTaskDraftStateAcknowledged } from "../workbench/task-draft-persistence.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { revokeDraftAttachments, type DraftAttachment } from "./composer-attachments.js";

export type PromptStashResult =
  | { status: "stashed" }
  | { status: "restored"; text: string }
  | {
      status: "cleanup-failed";
      completed: "deleted" | "restored";
      text?: string;
    }
  | {
      status:
        | "empty"
        | "full"
        | "too-large"
        | "file-references"
        | "unsupported-attachments"
        | "conflict"
        | "missing"
        | "persistence-failed";
    };

export async function stashComposerPrompt(taskId: string, workspaceId: string): Promise<PromptStashResult> {
  const draft = useTaskDraftStore.getState().drafts[taskId];
  const sourceText = draft?.text ?? "";
  const sourceAttachments = draft?.attachments ?? [];
  if (!sourceText.trim() && sourceAttachments.length === 0) return { status: "empty" };
  if ((draft?.workspaceFiles.length ?? 0) > 0) return { status: "file-references" };
  if (sourceAttachments.some((attachment) => attachment.kind !== "image")) {
    return { status: "unsupported-attachments" };
  }

  const itemId = crypto.randomUUID();
  let storedAttachments: PromptStashImageRef[] | undefined;
  if (sourceAttachments.length > 0) {
    try {
      const stored = await window.pi67.system.storePromptStashImages({
        workspaceId,
        taskId,
        itemId,
        attachmentIds: sourceAttachments.map((attachment) => attachment.id)
      });
      if (stored.itemId !== itemId) throw new Error("Prompt Stash image identity did not match the request.");
      storedAttachments = stored.attachments;
    } catch {
      return { status: "persistence-failed" };
    }
  }
  const item: PromptStashItem = {
    id: itemId,
    text: sourceText,
    createdAt: Date.now(),
    ...(storedAttachments?.length ? { attachments: storedAttachments } : {})
  };
  const admission = useTaskDraftStore.getState().addPromptStash(taskId, item);
  if (admission === "full" || admission === "too-large") {
    if (storedAttachments?.length) {
      await window.pi67.system.deletePromptStashImages({ taskId, itemId }).catch(() => undefined);
    }
    return { status: admission };
  }
  if (!await persistTaskDraftStateAcknowledged(taskId)) {
    if (admission === "added") useTaskDraftStore.getState().removePromptStash(taskId, item.id);
    if (storedAttachments?.length) {
      await window.pi67.system.deletePromptStashImages({ taskId, itemId }).catch(() => undefined);
    }
    return { status: "persistence-failed" };
  }

  const current = useTaskDraftStore.getState().drafts[taskId];
  if (current?.text !== sourceText || !sameAttachmentIds(current.attachments, sourceAttachments)) {
    return { status: "stashed" };
  }
  useTaskDraftStore.getState().setText(taskId, "");
  useTaskDraftStore.getState().setAttachments(taskId, []);
  if (!await persistTaskDraftStateAcknowledged(taskId)) {
    const cleared = useTaskDraftStore.getState().drafts[taskId];
    if (cleared?.text === "" && cleared.attachments.length === 0) {
      useTaskDraftStore.getState().setText(taskId, sourceText);
      useTaskDraftStore.getState().setAttachments(taskId, sourceAttachments);
    }
    return { status: "persistence-failed" };
  }
  revokeDraftAttachments(sourceAttachments);
  return { status: "stashed" };
}

export async function restoreComposerPromptStash(
  taskId: string,
  itemId: string
): Promise<PromptStashResult> {
  const draft = useTaskDraftStore.getState().drafts[taskId];
  if (!draft) return { status: "missing" };
  if (draft.text.trim() || draft.workspaceFiles.length > 0 || draft.attachments.length > 0) {
    return { status: "conflict" };
  }
  const item = draft.promptStash.find((candidate) => candidate.id === itemId);
  if (!item) return { status: "missing" };

  let restoredAttachments: DraftAttachment[] = [];
  if (item.attachments?.length) {
    try {
      const result = await window.pi67.system.restorePromptStashImages({ taskId, itemId });
      if (result.itemId !== itemId) throw new Error("Prompt Stash image identity did not match the request.");
      restoredAttachments = result.attachments.map((attachment) => ({
        ...attachment,
        identity: `stash:${itemId}:${attachment.id}`
      }));
    } catch {
      return { status: "persistence-failed" };
    }
  }
  useTaskDraftStore.getState().setText(taskId, item.text);
  useTaskDraftStore.getState().setAttachments(taskId, restoredAttachments);
  if (!await persistTaskDraftStateAcknowledged(taskId)) {
    const current = useTaskDraftStore.getState().drafts[taskId];
    if (current?.text === item.text && sameAttachmentIds(current.attachments, restoredAttachments)) {
      useTaskDraftStore.getState().setAttachments(taskId, []);
      useTaskDraftStore.getState().setText(taskId, "");
    }
    revokeDraftAttachments(restoredAttachments);
    return { status: "persistence-failed" };
  }
  useTaskDraftStore.getState().removePromptStash(taskId, itemId);
  if (!await persistTaskDraftStateAcknowledged(taskId)) {
    useTaskDraftStore.getState().addPromptStash(taskId, item);
    return { status: "persistence-failed" };
  }
  if (item.attachments?.length) {
    try {
      await window.pi67.system.deletePromptStashImages({ taskId, itemId });
    } catch {
      return { status: "cleanup-failed", completed: "restored", text: item.text };
    }
  }
  return { status: "restored", text: item.text };
}

export async function deleteComposerPromptStash(
  taskId: string,
  itemId: string
): Promise<PromptStashResult> {
  const item = useTaskDraftStore.getState().drafts[taskId]?.promptStash.find((candidate) => candidate.id === itemId);
  if (!item) return { status: "missing" };
  useTaskDraftStore.getState().removePromptStash(taskId, itemId);
  if (!await persistTaskDraftStateAcknowledged(taskId)) {
    useTaskDraftStore.getState().addPromptStash(taskId, item);
    return { status: "persistence-failed" };
  }
  if (item.attachments?.length) {
    try {
      await window.pi67.system.deletePromptStashImages({ taskId, itemId });
    } catch {
      return { status: "cleanup-failed", completed: "deleted" };
    }
  }
  return { status: "stashed" };
}

function sameAttachmentIds(left: readonly DraftAttachment[], right: readonly DraftAttachment[]): boolean {
  return left.length === right.length && left.every((attachment, index) => attachment.id === right[index]?.id);
}
