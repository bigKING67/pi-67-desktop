import type { RendererWorkbenchTask } from "../workbench/workbench-store.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistTaskDraftStateCheckpoint } from "../workbench/task-draft-persistence.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useConversationDialogStore } from "./conversation-dialog-store.js";
import {
  discardProvisionalDraft,
  provisionalDraftDiscardDisposition,
  requestProvisionalDraftDiscard
} from "./provisional-draft-discard-controller.js";

vi.mock("../workbench/task-draft-persistence.js", () => ({
  persistTaskDraftStateCheckpoint: vi.fn(async () => undefined)
}));

const persistCheckpoint = vi.mocked(persistTaskDraftStateCheckpoint);

describe("provisional draft discard", () => {
  beforeEach(() => {
    rendererWorkbenchStore.getState().reset();
    useTaskDraftStore.getState().dispose();
    useConversationDialogStore.setState(useConversationDialogStore.getInitialState(), true);
    persistCheckpoint.mockClear();
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-a",
      displayName: "Workspace A",
      identity: { canonicalPath: "/workspace-a", assurance: "path-only" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
  });

  it("discards empty or runtime-configuration-only drafts without confirmation", () => {
    const task = provisionalTask("draft-a");
    rendererWorkbenchStore.getState().openTask(task);
    expect(provisionalDraftDiscardDisposition(task, undefined)).toBe("discard");

    useTaskDraftStore.getState().setStartupModel(task.id, {
      provider: "deepseek",
      model: "deepseek-v4-flash"
    });
    expect(provisionalDraftDiscardDisposition(
      task,
      useTaskDraftStore.getState().drafts[task.id]
    )).toBe("discard");
  });

  it("asks for confirmation when the draft contains user-authored content", () => {
    const task = provisionalTask("draft-with-text");
    rendererWorkbenchStore.getState().openTask(task);
    useTaskDraftStore.getState().setText(task.id, "还没有发送的内容");

    requestProvisionalDraftDiscard(task.id, task.title);

    expect(useConversationDialogStore.getState().draftDiscardTarget).toEqual({
      taskId: task.id,
      title: task.title
    });
    expect(rendererWorkbenchStore.getState().tasks[task.id]).toBeDefined();
    expect(persistCheckpoint).not.toHaveBeenCalled();
  });

  it("removes only the provisional task and its draft before persisting the checkpoint", async () => {
    const task = provisionalTask("draft-discarded");
    rendererWorkbenchStore.getState().openTask(task);
    useTaskDraftStore.getState().setText(task.id, "丢弃我");

    await expect(discardProvisionalDraft(task.id)).resolves.toBe(true);

    expect(rendererWorkbenchStore.getState().tasks[task.id]).toBeUndefined();
    expect(useTaskDraftStore.getState().drafts[task.id]).toBeUndefined();
    expect(persistCheckpoint).toHaveBeenCalledOnce();
  });

  it("blocks a provisional record whose Session creation outcome is unconfirmed", async () => {
    const task = { ...provisionalTask("draft-unconfirmed"), creationStatus: "unconfirmed" as const };
    rendererWorkbenchStore.getState().openTask(task);

    expect(provisionalDraftDiscardDisposition(task, undefined)).toBe("blocked");
    await expect(discardProvisionalDraft(task.id)).resolves.toBe(false);
    expect(rendererWorkbenchStore.getState().tasks[task.id]).toBeDefined();
    expect(persistCheckpoint).not.toHaveBeenCalled();
  });

  it("requires confirmation when durable task state reports content that is not loaded in memory", () => {
    const task = { ...provisionalTask("draft-restored"), hasDraft: true };
    expect(provisionalDraftDiscardDisposition(task, undefined)).toBe("confirm");
  });
});

function provisionalTask(id: string): RendererWorkbenchTask {
  return {
    id,
    conversation: { kind: "provisional", workspaceId: "workspace-a", draftId: id },
    workspaceId: "workspace-a",
    sessionId: `pending:${id}`,
    taskGeneration: 1,
    lifecycle: "draft",
    runtime: { phase: "stopped", detail: "draft", recoverable: true },
    title: "未命名会话",
    hasDraft: false,
    toolMode: "auto",
    attachmentCount: 0
  };
}
