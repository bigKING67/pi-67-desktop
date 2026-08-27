import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rendererWorkbenchStore, type RendererWorkbenchTask } from "./workbench-store.js";
import { useTaskDraftStore } from "./task-draft-store.js";
import {
  restorePersistedDrafts,
  persistPromptStashRemovalAcknowledged,
  serializeTaskDraftState,
  shouldPublishBackgroundPersistenceFailure,
  shouldScheduleDraftPersistenceRetry
} from "./task-draft-persistence.js";
import { captureDraftRestoreSelectionGuard } from "./task-draft-restore-selection.js";
import { parseComposerDraftPersistedState } from "../../../desktop/src/composer-draft-state.js";

describe("task draft persistence", () => {
  beforeEach(() => {
    rendererWorkbenchStore.getState().reset();
    useTaskDraftStore.getState().dispose();
    rendererWorkbenchStore.getState().registerWorkspace(workspace());
  });

  afterEach(() => {
    rendererWorkbenchStore.getState().reset();
    useTaskDraftStore.getState().dispose();
  });

  it("serializes a selected Session draft using exact conversation identity", () => {
    const task = sessionTask("task-session-a", "session-file-a");
    expect(rendererWorkbenchStore.getState().restoreTask(task)).toBe(task.id);
    rendererWorkbenchStore.getState().selectTask(task.id);
    useTaskDraftStore.getState().setText(task.id, "继续完成当前对话");
    useTaskDraftStore.getState().setStreamBehavior(task.id, "steer");

    const serialized = serializeTaskDraftState(123);
    expect(serialized).toEqual({
      version: 1,
      drafts: [{
        conversation: task.conversation,
        text: "继续完成当前对话",
        streamBehavior: "steer",
        updatedAt: 123
      }],
      selectedConversation: task.conversation
    });
    expect(parseComposerDraftPersistedState(serialized)).toEqual(serialized);
  });

  it("keeps a transient duplicate conversation from invalidating every draft", () => {
    const authoritative = sessionTask("task-authoritative", "session-file-shared");
    const transient = provisionalTask("task-transient");
    expect(rendererWorkbenchStore.getState().restoreTask(authoritative)).toBe(authoritative.id);
    expect(rendererWorkbenchStore.getState().restoreTask(transient)).toBe(transient.id);
    useTaskDraftStore.getState().setText(authoritative.id, "旧的瞬态草稿");
    useTaskDraftStore.getState().setText(transient.id, "当前输入不应触发整包拒绝");
    if (authoritative.conversation.kind !== "session") throw new Error("Expected a Session conversation.");
    rendererWorkbenchStore.getState().updateTask(transient.id, {
      conversation: authoritative.conversation,
      sessionFileIdentity: authoritative.conversation.sessionFileIdentity,
      sessionPath: authoritative.conversation.sessionPath
    });

    const serialized = serializeTaskDraftState(124);
    expect(serialized.drafts).toHaveLength(1);
    expect(serialized.drafts[0]?.text).toBe("当前输入不应触发整包拒绝");
    expect(parseComposerDraftPersistedState(serialized)).toEqual(serialized);
  });

  it("retries background writes quietly and records only sustained distinct failures", () => {
    expect(shouldScheduleDraftPersistenceRetry(false, false)).toBe(true);
    expect(shouldScheduleDraftPersistenceRetry(true, false)).toBe(false);
    expect(shouldScheduleDraftPersistenceRetry(false, true)).toBe(false);
    expect(shouldPublishBackgroundPersistenceFailure(2, "invalid", undefined)).toBe(false);
    expect(shouldPublishBackgroundPersistenceFailure(3, "invalid", undefined)).toBe(true);
    expect(shouldPublishBackgroundPersistenceFailure(4, "invalid", "invalid")).toBe(false);
    expect(shouldPublishBackgroundPersistenceFailure(4, "changed", "invalid")).toBe(true);
  });

  it("persists Workspace file refs separately from the durable text token", () => {
    const task = sessionTask("task-session-file", "session-file-ref");
    expect(rendererWorkbenchStore.getState().restoreTask(task)).toBe(task.id);
    useTaskDraftStore.getState().setText(task.id, "inspect @[src/main.ts]");
    useTaskDraftStore.getState().setWorkspaceFiles(task.id, [{
      id: "file-a",
      revision: "revision-a",
      relativePath: "src/main.ts"
    }]);

    expect(serializeTaskDraftState(124).drafts[0]).toMatchObject({
      text: "inspect @[src/main.ts]",
      workspaceFiles: [{
        id: "file-a",
        revision: "revision-a",
        relativePath: "src/main.ts"
      }]
    });
  });

  it("persists review-only drafts without persisting Patch source bodies", () => {
    const task = sessionTask("task-session-review", "session-file-review");
    expect(rendererWorkbenchStore.getState().restoreTask(task)).toBe(task.id);
    useTaskDraftStore.getState().addReviewComment(task.id, {
      id: "review-a",
      authority: {
        source: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-review",
        toolCallId: "tool-a",
        contentFingerprint: "24:abcd"
      },
      anchor: { section: "session", side: "new", startLine: 12, endLine: 12 },
      body: "Keep the failure observable.",
      createdAt: 125,
      file: { id: "file-a", revision: "revision-a", relativePath: "src/main.ts" }
    });

    const serialized = serializeTaskDraftState(126);
    expect(serialized.drafts[0]).toMatchObject({
      text: "",
      reviewComments: [{
        id: "review-a",
        body: "Keep the failure observable.",
        file: { id: "file-a", revision: "revision-a", relativePath: "src/main.ts" }
      }]
    });
    expect(JSON.stringify(serialized)).not.toContain("@@ -");
  });

  it("serializes text-only Prompt stash without attachment metadata or bytes", () => {
    const task = sessionTask("task-session-stash", "session-file-stash");
    expect(rendererWorkbenchStore.getState().restoreTask(task)).toBe(task.id);
    useTaskDraftStore.getState().addPromptStash(task.id, {
      id: "stash-1",
      text: "run this after the current task",
      createdAt: 125
    });
    useTaskDraftStore.getState().setAttachments(task.id, [{
      id: "attachment-secret",
      name: "private.png",
      mimeType: "image/png",
      byteLength: 1024,
      kind: "image",
      identity: "private-attachment-identity",
      previewUrl: "blob:private-preview"
    }]);

    const state = serializeTaskDraftState(126);
    expect(state.drafts).toEqual([{
      conversation: task.conversation,
      text: "",
      streamBehavior: "followUp",
      updatedAt: 126,
      promptStash: [{
        id: "stash-1",
        text: "run this after the current task",
        createdAt: 125
      }]
    }]);
    expect(JSON.stringify(state)).not.toContain("attachment-secret");
    expect(JSON.stringify(state)).not.toContain("private-preview");
    useTaskDraftStore.getState().setAttachments(task.id, []);
  });

  it("acknowledges deleting the final Prompt stash item as an empty persisted state", async () => {
    const task = sessionTask("task-session-stash-delete", "session-file-stash-delete");
    expect(rendererWorkbenchStore.getState().restoreTask(task)).toBe(task.id);
    useTaskDraftStore.getState().addPromptStash(task.id, {
      id: "only-stash",
      text: "delete this",
      createdAt: 125
    });
    useTaskDraftStore.getState().removePromptStash(task.id, "only-stash");
    const updateComposerDraftState = vi.fn(async (state) => ({
      state: structuredClone(state),
      persistence: "available" as const
    }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { pi67: { system: { updateComposerDraftState } } }
    });

    await expect(persistPromptStashRemovalAcknowledged(task.id, "only-stash"))
      .resolves.toBe("persisted");
    expect(updateComposerDraftState).toHaveBeenCalledWith({ version: 1, drafts: [] });
  });

  it("rotates a provisional draft to the materialized Session identity", () => {
    const task = provisionalTask("task-intent-a");
    expect(rendererWorkbenchStore.getState().restoreTask(task)).toBe(task.id);
    useTaskDraftStore.getState().setText(task.id, "创建后立即发送");
    const conversation = sessionTask(task.id, "session-file-materialized").conversation;
    if (conversation.kind !== "session") throw new Error("Expected a Session conversation.");
    rendererWorkbenchStore.getState().updateTask(task.id, {
      conversation,
      sessionFileIdentity: "session-file-materialized",
      sessionPath: conversation.sessionPath
    });

    expect(serializeTaskDraftState(456).drafts).toEqual([{
      conversation,
      text: "创建后立即发送",
      streamBehavior: "followUp",
      updatedAt: 456
    }]);
  });

  it("does not let delayed draft restoration replace a Session selected after startup", () => {
    const previous = sessionTask("task-session-previous", "session-file-previous");
    expect(rendererWorkbenchStore.getState().restoreTask(previous)).toBe(previous.id);
    rendererWorkbenchStore.getState().selectTask(previous.id);
    const selectionGuard = captureDraftRestoreSelectionGuard();

    const current = provisionalTask("task-session-current");
    rendererWorkbenchStore.getState().openTask(current);
    const currentConversation = sessionTask(current.id, "session-file-current").conversation;
    if (currentConversation.kind !== "session") throw new Error("Expected a Session conversation.");
    rendererWorkbenchStore.getState().updateTask(current.id, {
      conversation: currentConversation,
      sessionId: "session-current",
      sessionFileIdentity: currentConversation.sessionFileIdentity,
      sessionPath: currentConversation.sessionPath
    });

    restorePersistedDrafts({
      version: 1,
      drafts: [{
        conversation: previous.conversation,
        text: "previous draft",
        streamBehavior: "followUp",
        updatedAt: 900
      }],
      selectedConversation: previous.conversation
    }, { restoreSelection: selectionGuard.release() });

    expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({
      kind: "conversation",
      conversation: currentConversation
    });
  });

  it("allows draft restoration to select its saved conversation when startup selection stayed unchanged", () => {
    rendererWorkbenchStore.getState().selectWorkspace("workspace-a");
    const selectionGuard = captureDraftRestoreSelectionGuard();
    const restored = provisionalTask("task-restored-at-startup");

    restorePersistedDrafts({
      version: 1,
      drafts: [{
        conversation: restored.conversation,
        text: "restored draft",
        streamBehavior: "followUp",
        updatedAt: 901
      }],
      selectedConversation: restored.conversation
    }, { restoreSelection: selectionGuard.release() });

    expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({
      kind: "conversation",
      conversation: restored.conversation
    });
  });

  it("does not persist empty text as a durable attachment promise", () => {
    const task = provisionalTask("task-intent-empty");
    expect(rendererWorkbenchStore.getState().restoreTask(task)).toBe(task.id);
    useTaskDraftStore.getState().setStreamBehavior(task.id, "steer");

    expect(serializeTaskDraftState(789)).toEqual({ version: 1, drafts: [] });
  });

  it("persists Worktree intent with a non-empty provisional draft but never on a materialized Session", () => {
    const provisional = provisionalTask("task-intent-worktree");
    provisional.environmentIntent = "worktree";
    expect(rendererWorkbenchStore.getState().restoreTask(provisional)).toBe(provisional.id);
    useTaskDraftStore.getState().setText(provisional.id, "在隔离目录中完成");
    expect(serializeTaskDraftState(800).drafts).toEqual([{
      conversation: provisional.conversation,
      text: "在隔离目录中完成",
      streamBehavior: "followUp",
      updatedAt: 800,
      environmentIntent: "worktree"
    }]);

    const conversation = sessionTask(provisional.id, "session-file-worktree").conversation;
    if (conversation.kind !== "session") throw new Error("Expected a Session conversation.");
    rendererWorkbenchStore.getState().updateTask(provisional.id, {
      conversation,
      sessionFileIdentity: conversation.sessionFileIdentity,
      sessionPath: conversation.sessionPath
    });
    expect(serializeTaskDraftState(801).drafts[0]?.environmentIntent).toBeUndefined();
  });

  it("persists Plan Mode for a provisional first message but defers materialized state to Pi JSONL", () => {
    const provisional = provisionalTask("task-intent-plan");
    expect(rendererWorkbenchStore.getState().restoreTask(provisional)).toBe(provisional.id);
    useTaskDraftStore.getState().setText(provisional.id, "先制定计划");
    useTaskDraftStore.getState().setInteractionMode(provisional.id, "plan");

    expect(serializeTaskDraftState(802).drafts[0]).toMatchObject({
      conversation: provisional.conversation,
      text: "先制定计划",
      interactionMode: "plan"
    });

    const conversation = sessionTask(provisional.id, "session-file-plan").conversation;
    if (conversation.kind !== "session") throw new Error("Expected a Session conversation.");
    rendererWorkbenchStore.getState().updateTask(provisional.id, {
      conversation,
      sessionFileIdentity: conversation.sessionFileIdentity,
      sessionPath: conversation.sessionPath
    });
    expect(serializeTaskDraftState(803).drafts[0]?.interactionMode).toBeUndefined();
  });
});

function workspace() {
  return {
    id: "workspace-a",
    displayName: "Workspace A",
    identity: { canonicalPath: resolve("workspace-a"), assurance: "path-only" as const },
    trust: "trusted" as const,
    trustProvenance: "native-picker" as const,
    availability: "available" as const
  };
}

function provisionalTask(id: string): RendererWorkbenchTask {
  return {
    id,
    conversation: { kind: "provisional", workspaceId: "workspace-a", draftId: id },
    workspaceId: "workspace-a",
    sessionId: `pending:${id}`,
    taskGeneration: 1,
    lifecycle: "draft",
    runtime: { phase: "stopped", detail: "首条消息尚未发送", recoverable: true },
    title: "未命名会话",
    hasDraft: true,
    attachmentCount: 0,
    toolMode: "auto"
  };
}

function sessionTask(id: string, fileIdentity: string): RendererWorkbenchTask {
  const sessionPath = resolve(`sessions/${fileIdentity}.jsonl`);
  return {
    id,
    conversation: {
      kind: "session",
      workspaceId: "workspace-a",
      sessionFileIdentity: fileIdentity,
      sessionPath
    },
    workspaceId: "workspace-a",
    sessionId: `pending:${id}`,
    taskGeneration: 1,
    sessionFileIdentity: fileIdentity,
    sessionPath,
    lifecycle: "stopped",
    runtime: { phase: "stopped", detail: "草稿等待恢复", recoverable: true },
    title: "未命名会话",
    hasDraft: true,
    attachmentCount: 0,
    toolMode: "auto"
  };
}
