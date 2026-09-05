import type { PromptStashImageRef, PromptStashItem } from "@pi67/domain";
import {
  persistPromptStashRemovalAcknowledged,
  persistTaskDraftStateAcknowledged,
  type TaskDraftPersistenceOutcome
} from "../workbench/task-draft-persistence.js";
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
        | "secure-storage-unavailable"
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
  const secureStorageFailure = await ensurePromptStashSecureStorage();
  if (secureStorageFailure) return secureStorageFailure;

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
  const stashPersistence = await persistTaskDraftStateAcknowledged(taskId);
  if (stashPersistence !== "persisted") {
    if (admission === "added") useTaskDraftStore.getState().removePromptStash(taskId, item.id);
    if (storedAttachments?.length) {
      await window.pi67.system.deletePromptStashImages({ taskId, itemId }).catch(() => undefined);
    }
    return persistenceFailure(stashPersistence);
  }

  const current = useTaskDraftStore.getState().drafts[taskId];
  if (current?.text !== sourceText || !sameAttachmentIds(current.attachments, sourceAttachments)) {
    return { status: "stashed" };
  }
  useTaskDraftStore.getState().setText(taskId, "");
  useTaskDraftStore.getState().setAttachments(taskId, []);
  const clearPersistence = await persistTaskDraftStateAcknowledged(taskId);
  if (clearPersistence !== "persisted") {
    const cleared = useTaskDraftStore.getState().drafts[taskId];
    if (cleared?.text === "" && cleared.attachments.length === 0) {
      useTaskDraftStore.getState().setText(taskId, sourceText);
      useTaskDraftStore.getState().setAttachments(taskId, sourceAttachments);
    }
    return persistenceFailure(clearPersistence);
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
  const secureStorageFailure = await ensurePromptStashSecureStorage();
  if (secureStorageFailure) return secureStorageFailure;

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
  const beforeRestore = useTaskDraftStore.getState().drafts[taskId];
  if (beforeRestore !== draft) {
    revokeDraftAttachments(restoredAttachments);
    return { status: beforeRestore ? "conflict" : "missing" };
  }
  useTaskDraftStore.getState().setText(taskId, item.text);
  useTaskDraftStore.getState().setAttachments(taskId, restoredAttachments);
  const restoredDraft = useTaskDraftStore.getState().drafts[taskId];
  const restorePersistence = await persistTaskDraftStateAcknowledged(taskId);
  if (restorePersistence !== "persisted") {
    const current = useTaskDraftStore.getState().drafts[taskId];
    if (current === restoredDraft) {
      useTaskDraftStore.getState().setAttachments(taskId, []);
      useTaskDraftStore.getState().setText(taskId, draft.text);
      revokeDraftAttachments(restoredAttachments);
    }
    return persistenceFailure(restorePersistence);
  }
  useTaskDraftStore.getState().removePromptStash(taskId, itemId);
  const removalPersistence = await persistPromptStashRemovalAcknowledged(taskId, itemId);
  if (removalPersistence !== "persisted") {
    useTaskDraftStore.getState().addPromptStash(taskId, item);
    return persistenceFailure(removalPersistence);
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
  const secureStorageFailure = await ensurePromptStashSecureStorage();
  if (secureStorageFailure) return secureStorageFailure;
  useTaskDraftStore.getState().removePromptStash(taskId, itemId);
  const deletePersistence = await persistPromptStashRemovalAcknowledged(taskId, itemId);
  if (deletePersistence !== "persisted") {
    useTaskDraftStore.getState().addPromptStash(taskId, item);
    return persistenceFailure(deletePersistence);
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

async function ensurePromptStashSecureStorage(): Promise<PromptStashResult | undefined> {
  try {
    return await window.pi67.system.ensureSecureStorageAccess() === "available"
      ? undefined
      : { status: "secure-storage-unavailable" };
  } catch {
    return { status: "persistence-failed" };
  }
}

function persistenceFailure(outcome: TaskDraftPersistenceOutcome): PromptStashResult {
  return {
    status: outcome === "secure-storage-unavailable"
      ? "secure-storage-unavailable"
      : "persistence-failed"
  };
}
