import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RendererWorkbenchTask } from "../workbench/workbench-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { workspaceChangeFingerprint } from "./changes-read-store.js";
import {
  prepareComposerReviewSubmission,
  reviewCommentIdsAcceptedBySubmission
} from "./change-review-controller.js";
import { useWorkspaceChangesStore } from "./workspace-changes-store.js";

const change = {
  kind: "edit" as const,
  toolCallId: "tool-a",
  path: "src/main.ts",
  pathTruncated: false,
  status: "completed" as const,
  patch: "@@ -4 +4 @@\n-before\n+after",
  patchTruncated: false,
  additions: 1,
  deletions: 1
};

describe("change review submission", () => {
  beforeEach(() => {
    rendererWorkbenchStore.getState().reset();
    useTaskDraftStore.getState().dispose();
    useWorkspaceChangesStore.getState().reset();
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-a",
      displayName: "Workspace A",
      identity: { canonicalPath: "/work/a", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    rendererWorkbenchStore.getState().restoreTask(task());
    const authority = {
      hostEpoch: 7,
      sessionId: "session-a",
      sessionFileIdentity: "session-file-a",
      sessionGeneration: 2,
      projectionRevision: 3
    };
    useWorkspaceChangesStore.getState().beginSession(authority);
    useWorkspaceChangesStore.getState().installProjection(authority, {
      sessionId: "session-a",
      items: [change],
      truncated: false,
      total: 1
    });
  });

  afterEach(() => {
    rendererWorkbenchStore.getState().reset();
    useTaskDraftStore.getState().dispose();
    useWorkspaceChangesStore.getState().reset();
  });

  it("formats exact comments into the existing prompt side effect and binds opaque files", () => {
    useTaskDraftStore.getState().addReviewComment("task-a", reviewComment());
    const prepared = prepareComposerReviewSubmission("task-a", "Please fix the review.", []);
    expect(prepared).toMatchObject({ ok: true, commentIds: ["review-a"] });
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.text).toContain("Please fix the review.");
    expect(prepared.text).toContain("`src/main.ts` · session · 新第 4 行");
    expect(prepared.text).toContain("Keep the failure observable.");
    expect(prepared.text).not.toContain("-before");
    expect(prepared.workspaceFiles).toEqual([
      { id: "file-a", revision: "revision-a", relativePath: "src/main.ts" }
    ]);
  });

  it("blocks stale comments instead of silently sending them", () => {
    useTaskDraftStore.getState().addReviewComment("task-a", reviewComment());
    useWorkspaceChangesStore.getState().applyChange(
      {
        hostEpoch: 7,
        sessionId: "session-a",
        sessionFileIdentity: "session-file-a",
        sessionGeneration: 2,
        projectionRevision: 3
      },
      { ...change, patch: "@@ -4 +4 @@\n-before\n+different" }
    );
    expect(prepareComposerReviewSubmission("task-a", "", [])).toEqual({
      ok: false,
      message: "有 1 条修改意见对应的 Diff 已变化。请删除旧意见或刷新后重新批注。"
    });
  });

  it("clears only the submitted snapshot after real acceptance", () => {
    useTaskDraftStore.getState().addReviewComment("task-a", reviewComment());
    const submittedIds = ["review-a"];

    expect(reviewCommentIdsAcceptedBySubmission(
      { accepted: false },
      submittedIds
    )).toEqual([]);
    expect(reviewCommentIdsAcceptedBySubmission(
      { accepted: true, terminalError: "Provider failed" },
      submittedIds
    )).toEqual([]);

    useTaskDraftStore.getState().addReviewComment("task-a", {
      ...reviewComment(),
      id: "review-new",
      body: "Added while the submission was in flight."
    });
    useTaskDraftStore.getState().removeReviewComments(
      "task-a",
      reviewCommentIdsAcceptedBySubmission({ accepted: true }, submittedIds)
    );
    expect(useTaskDraftStore.getState().drafts["task-a"]?.reviewComments.map((comment) => comment.id))
      .toEqual(["review-new"]);
  });
});

function task(): RendererWorkbenchTask {
  return {
    id: "task-a",
    conversation: {
      kind: "session",
      workspaceId: "workspace-a",
      sessionFileIdentity: "session-file-a",
      sessionPath: "/sessions/a.jsonl"
    },
    workspaceId: "workspace-a",
    sessionId: "session-a",
    sessionGeneration: 2,
    taskGeneration: 1,
    sessionFileIdentity: "session-file-a",
    sessionPath: "/sessions/a.jsonl",
    lifecycle: "stopped",
    runtime: { phase: "ready", detail: "ready", recoverable: true },
    title: "A",
    hasDraft: false,
    attachmentCount: 0,
    toolMode: "auto"
  };
}

function reviewComment() {
  return {
    id: "review-a",
    authority: {
      source: "session" as const,
      workspaceId: "workspace-a",
      sessionFileIdentity: "session-file-a",
      toolCallId: "tool-a",
      contentFingerprint: workspaceChangeFingerprint(change)
    },
    anchor: { section: "session" as const, side: "new" as const, startLine: 4, endLine: 4 },
    body: "Keep the failure observable.",
    createdAt: 4,
    file: { id: "file-a", revision: "revision-a", relativePath: "src/main.ts" }
  };
}
