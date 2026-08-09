import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerReviewComment } from "@pi67/domain";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import type { DraftAttachment } from "./composer-attachments.js";

const mocks = vi.hoisted(() => ({
  newSession: vi.fn(),
  prompt: vi.fn(),
  revoke: vi.fn()
}));

vi.mock("../session/new-session-intent-controller.js", () => ({
  submitRendererNewSessionIntent: mocks.newSession
}));
vi.mock("./prompt-submission-controller.js", () => ({
  submitRendererPrompt: mocks.prompt
}));
vi.mock("./composer-attachments.js", () => ({
  revokeDraftAttachments: mocks.revoke
}));

import {
  clearAcceptedComposerDraft,
  submitComposerDraft
} from "./composer-submission-controller.js";

describe("composer submission controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.newSession.mockResolvedValue({
      accepted: true,
      operationId: "operation-new",
      retainsAttachmentPreviews: false
    });
    mocks.prompt.mockResolvedValue({
      accepted: true,
      operationId: "operation-prompt",
      retainsAttachmentPreviews: false
    });
  });

  afterEach(() => {
    useTaskDraftStore.getState().dispose();
  });

  it("routes provisional and materialized submissions through their existing authorities", async () => {
    const common = {
      taskId: "task-a",
      text: "review this",
      submissionId: "submission-a",
      attachments: [attachment()],
      workspaceFiles: [{ id: "file-a", revision: "r1", relativePath: "src/a.ts" }],
      activeStreaming: true,
      streamBehavior: "steer" as const
    };

    await submitComposerDraft({ ...common, provisional: true });
    expect(mocks.newSession).toHaveBeenCalledWith(
      "task-a",
      "review this",
      "submission-a",
      common.attachments,
      common.workspaceFiles
    );
    expect(mocks.prompt).not.toHaveBeenCalled();

    await submitComposerDraft({ ...common, provisional: false });
    expect(mocks.prompt).toHaveBeenCalledWith(
      "review this",
      "steer",
      "submission-a",
      common.attachments,
      common.workspaceFiles
    );

    await submitComposerDraft({
      ...common,
      provisional: false,
      activeStreaming: false,
      streamBehavior: "followUp"
    });
    expect(mocks.prompt).toHaveBeenLastCalledWith(
      "review this",
      "send",
      "submission-a",
      common.attachments,
      common.workspaceFiles
    );
  });

  it("clears only the exact accepted review snapshot and releases unretained previews", () => {
    seedDraft("task-a");

    clearAcceptedComposerDraft({
      taskId: "task-a",
      result: {
        accepted: true,
        operationId: "operation-a",
        retainsAttachmentPreviews: false
      },
      attachments: [attachment()],
      reviewCommentIds: ["review-a"]
    });

    expect(useTaskDraftStore.getState().drafts["task-a"]).toMatchObject({
      text: "",
      attachments: [],
      workspaceFiles: [],
      reviewComments: []
    });
    expect(mocks.revoke).toHaveBeenCalledOnce();
  });

  it("preserves review comments after an accepted terminal failure and retained previews", () => {
    seedDraft("task-b");

    clearAcceptedComposerDraft({
      taskId: "task-b",
      result: {
        accepted: true,
        operationId: "operation-b",
        retainsAttachmentPreviews: true,
        terminalError: "Provider failed"
      },
      attachments: [attachment()],
      reviewCommentIds: ["review-a"]
    });

    expect(useTaskDraftStore.getState().drafts["task-b"]?.reviewComments)
      .toEqual([expect.objectContaining({ id: "review-a" })]);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
});

function seedDraft(taskId: string): void {
  const store = useTaskDraftStore.getState();
  store.setText(taskId, "draft");
  store.setAttachments(taskId, [attachment()]);
  store.setWorkspaceFiles(taskId, [{ id: "file-a", revision: "r1", relativePath: "src/a.ts" }]);
  expect(store.addReviewComment(taskId, reviewComment())).toBe("added");
}

function attachment(): DraftAttachment {
  return {
    id: "attachment-a",
    identity: "attachment-identity",
    name: "a.txt",
    mimeType: "text/plain",
    byteLength: 1,
    kind: "document"
  };
}

function reviewComment(): ComposerReviewComment {
  return {
    id: "review-a",
    authority: {
      source: "session",
      workspaceId: "workspace-a",
      sessionFileIdentity: "session-file-a",
      toolCallId: "tool-a",
      contentFingerprint: "fingerprint-a"
    },
    anchor: { section: "session", side: "new", startLine: 2, endLine: 2 },
    body: "Fix this line.",
    createdAt: 1,
    file: { id: "file-a", revision: "r1", relativePath: "src/a.ts" }
  };
}
