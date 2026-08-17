import type { ComposerWorkspaceFileRef } from "@pi67/domain";
import { reviewCommentIdsAcceptedBySubmission } from "../changes/change-review-controller.js";
import { submitRendererNewSessionIntent } from "../session/new-session-intent-controller.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { revokeDraftAttachments, type DraftAttachment } from "./composer-attachments.js";
import {
  submitRendererPrompt,
  type PromptSubmissionResult
} from "./prompt-submission-controller.js";
import { promptTextValidationMessage } from "./prompt-text-validation.js";

export function submitComposerDraft(input: {
  taskId: string;
  provisional: boolean;
  text: string;
  submissionId: string;
  attachments: readonly DraftAttachment[];
  workspaceFiles: readonly ComposerWorkspaceFileRef[];
  activeStreaming: boolean;
  streamBehavior: "steer" | "followUp";
}): Promise<PromptSubmissionResult> {
  const validationError = promptTextValidationMessage(input.text);
  if (validationError) return Promise.resolve({ accepted: false, error: validationError });
  return input.provisional
    ? submitRendererNewSessionIntent(
        input.taskId,
        input.text,
        input.submissionId,
        input.attachments,
        input.workspaceFiles
      )
    : submitRendererPrompt(
        input.text,
        input.activeStreaming ? input.streamBehavior : "send",
        input.submissionId,
        input.attachments,
        input.workspaceFiles
      );
}

export function clearAcceptedComposerDraft(input: {
  taskId: string;
  result: Extract<PromptSubmissionResult, { accepted: true }>;
  attachments: readonly DraftAttachment[];
  reviewCommentIds: readonly string[];
}): void {
  const drafts = useTaskDraftStore.getState();
  drafts.setText(input.taskId, "");
  drafts.setWorkspaceFiles(input.taskId, []);
  drafts.removeReviewComments(
    input.taskId,
    reviewCommentIdsAcceptedBySubmission(input.result, input.reviewCommentIds)
  );
  if (!input.result.retainsAttachmentPreviews) revokeDraftAttachments(input.attachments);
  drafts.setAttachments(input.taskId, []);
}
