import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rendererWorkbenchStore, type RendererWorkbenchTask } from "./workbench-store.js";
import { useTaskDraftStore } from "./task-draft-store.js";
import { serializeTaskDraftState } from "./task-draft-persistence.js";

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

    expect(serializeTaskDraftState(123)).toEqual({
      version: 1,
      drafts: [{
        conversation: task.conversation,
        text: "继续完成当前对话",
        streamBehavior: "steer",
        updatedAt: 123
      }],
      selectedConversation: task.conversation
    });
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

  it("does not persist empty text as a durable attachment promise", () => {
    const task = provisionalTask("task-intent-empty");
    expect(rendererWorkbenchStore.getState().restoreTask(task)).toBe(task.id);
    useTaskDraftStore.getState().setStreamBehavior(task.id, "steer");

    expect(serializeTaskDraftState(789)).toEqual({ version: 1, drafts: [] });
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
