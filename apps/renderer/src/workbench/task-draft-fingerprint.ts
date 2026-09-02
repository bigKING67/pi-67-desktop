import type { ComposerDraftRecord } from "@pi67/domain";
import type { RendererWorkbenchTask } from "./workbench-store.js";
import type { TaskDraft } from "./task-draft-store.js";

export function taskDraftFingerprint(
  draft: TaskDraft,
  environmentIntent: RendererWorkbenchTask["environmentIntent"]
): string {
  return `${draft.streamBehavior}\0${draft.interactionMode}\0${environmentIntent ?? "local"}\0${startupModelFingerprint(draft.startupModel)}\0${draft.startupThinkingLevel ?? ""}\0${draft.text}\0${workspaceFileFingerprint(draft.workspaceFiles)}\0${reviewCommentFingerprint(draft.reviewComments)}\0${promptStashFingerprint(draft.promptStash)}`;
}

export function draftContentFingerprint(record: ComposerDraftRecord): string {
  return `${record.streamBehavior}\0${record.interactionMode ?? "execute"}\0${record.environmentIntent ?? "local"}\0${startupModelFingerprint(record.startupModel)}\0${record.startupThinkingLevel ?? ""}\0${record.text}\0${workspaceFileFingerprint(record.workspaceFiles ?? [])}\0${reviewCommentFingerprint(record.reviewComments ?? [])}\0${promptStashFingerprint(record.promptStash ?? [])}`;
}

function startupModelFingerprint(selection: ComposerDraftRecord["startupModel"]): string {
  return selection ? `${selection.provider}/${selection.model}` : "";
}

function reviewCommentFingerprint(
  comments: readonly NonNullable<ComposerDraftRecord["reviewComments"]>[number][]
): string {
  return comments.map((comment) => JSON.stringify(comment)).join("\0");
}

export function cloneReviewComment(comment: NonNullable<ComposerDraftRecord["reviewComments"]>[number]) {
  return {
    ...comment,
    authority: { ...comment.authority },
    anchor: { ...comment.anchor },
    file: { ...comment.file }
  };
}

function promptStashFingerprint(items: readonly {
  id: string;
  text: string;
  createdAt: number;
  attachments?: readonly { blobId: string; name: string; mimeType: string; byteLength: number }[];
}[]): string {
  return items.map((item) => (
    `${item.id}\0${item.createdAt}\0${item.text}\0${(item.attachments ?? []).map((attachment) => (
      `${attachment.blobId}:${attachment.mimeType}:${attachment.byteLength}:${attachment.name}`
    )).join("|")}`
  )).join("\0");
}

function workspaceFileFingerprint(
  references: readonly { id: string; revision: string; relativePath: string }[]
): string {
  return references.map((reference) => (
    `${reference.id}\0${reference.revision}\0${reference.relativePath}`
  )).join("\0");
}
