import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  persistPromptStashRemovalAcknowledged,
  persistTaskDraftStateAcknowledged
} from "../workbench/task-draft-persistence.js";
import type { TaskDraftPersistenceOutcome } from "../workbench/task-draft-persistence.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import {
  deleteComposerPromptStash,
  restoreComposerPromptStash,
  stashComposerPrompt
} from "./prompt-stash-controller.js";

vi.mock("../workbench/task-draft-persistence.js", () => ({
  persistPromptStashRemovalAcknowledged: vi.fn(),
  persistTaskDraftStateAcknowledged: vi.fn()
}));

const persist = vi.mocked(persistTaskDraftStateAcknowledged);
const persistRemoval = vi.mocked(persistPromptStashRemovalAcknowledged);
const ensureSecureStorageAccess = vi.fn();
const storeImages = vi.fn();
const restoreImages = vi.fn();
const deleteImages = vi.fn();
const releaseAttachments = vi.fn().mockResolvedValue(undefined);

describe("Prompt stash controller", () => {
  beforeEach(() => {
    persist.mockReset();
    persistRemoval.mockReset().mockResolvedValue("persisted");
    ensureSecureStorageAccess.mockReset().mockResolvedValue("available");
    storeImages.mockReset();
    restoreImages.mockReset();
    deleteImages.mockReset();
    releaseAttachments.mockClear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        pi67: {
          system: {
            ensureSecureStorageAccess,
            storePromptStashImages: storeImages,
            restorePromptStashImages: restoreImages,
            deletePromptStashImages: deleteImages,
            releasePromptAttachments: releaseAttachments
          }
        }
      }
    });
    useTaskDraftStore.getState().dispose();
  });

  it("does not clear the Composer until encrypted persistence acknowledges the stash", async () => {
    const acknowledgement = deferred<TaskDraftPersistenceOutcome>();
    persist.mockReturnValueOnce(acknowledgement.promise).mockResolvedValueOnce("persisted");
    useTaskDraftStore.getState().setText("task", "keep this prompt");

    const result = stashComposerPrompt("task", "workspace-a");
    await vi.waitFor(() => {
      expect(useTaskDraftStore.getState().drafts.task?.promptStash).toHaveLength(1);
    });
    expect(useTaskDraftStore.getState().drafts.task?.text).toBe("keep this prompt");

    acknowledgement.resolve("persisted");
    await expect(result).resolves.toEqual({ status: "stashed" });
    expect(useTaskDraftStore.getState().drafts.task?.text).toBe("");
  });

  it("preserves exact text and never clears a newer Composer edit", async () => {
    const acknowledgement = deferred<TaskDraftPersistenceOutcome>();
    persist.mockReturnValueOnce(acknowledgement.promise);
    useTaskDraftStore.getState().setText("task", "  keep spacing\n");

    const result = stashComposerPrompt("task", "workspace-a");
    useTaskDraftStore.getState().setText("task", "newer edit");
    acknowledgement.resolve("persisted");

    await expect(result).resolves.toEqual({ status: "stashed" });
    expect(useTaskDraftStore.getState().drafts.task).toMatchObject({
      text: "newer edit",
      promptStash: [{ text: "  keep spacing\n" }]
    });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("clears a duplicate only after confirming the existing stash", async () => {
    persist.mockResolvedValue("persisted");
    useTaskDraftStore.getState().addPromptStash("task", {
      id: "existing",
      text: "same prompt",
      createdAt: 1
    });
    useTaskDraftStore.getState().setText("task", "same prompt");

    await expect(stashComposerPrompt("task", "workspace-a")).resolves.toEqual({ status: "stashed" });
    expect(useTaskDraftStore.getState().drafts.task).toMatchObject({
      text: "",
      promptStash: [{ id: "existing", text: "same prompt", createdAt: 1 }]
    });
  });

  it("keeps the original text and rolls back a new stash item when persistence fails", async () => {
    persist.mockResolvedValueOnce("failed");
    useTaskDraftStore.getState().setText("task", "never lose this");

    await expect(stashComposerPrompt("task", "workspace-a")).resolves.toEqual({ status: "persistence-failed" });
    expect(useTaskDraftStore.getState().drafts.task?.text).toBe("never lose this");
    expect(useTaskDraftStore.getState().drafts.task?.promptStash).toEqual([]);
  });

  it("keeps the Composer untouched when an explicit secure-storage retry is unavailable", async () => {
    ensureSecureStorageAccess.mockResolvedValue("unavailable");
    useTaskDraftStore.getState().setText("task", "still in the Composer");

    await expect(stashComposerPrompt("task", "workspace-a"))
      .resolves.toEqual({ status: "secure-storage-unavailable" });
    expect(ensureSecureStorageAccess).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
    expect(useTaskDraftStore.getState().drafts.task).toMatchObject({
      text: "still in the Composer",
      promptStash: []
    });
  });

  it("treats an unavailable persistence snapshot as a failed stash acknowledgement", async () => {
    persist.mockResolvedValueOnce("secure-storage-unavailable");
    useTaskDraftStore.getState().setText("task", "do not clear this draft");

    await expect(stashComposerPrompt("task", "workspace-a"))
      .resolves.toEqual({ status: "secure-storage-unavailable" });
    expect(useTaskDraftStore.getState().drafts.task).toMatchObject({
      text: "do not clear this draft",
      promptStash: []
    });
  });

  it("restores the original text when clearing it cannot be acknowledged", async () => {
    persist.mockResolvedValueOnce("persisted").mockResolvedValueOnce("failed");
    useTaskDraftStore.getState().setText("task", "durable before clear");

    await expect(stashComposerPrompt("task", "workspace-a")).resolves.toEqual({ status: "persistence-failed" });
    expect(useTaskDraftStore.getState().drafts.task).toMatchObject({
      text: "durable before clear",
      promptStash: [{ text: "durable before clear" }]
    });
  });

  it("restores only into an empty Composer and removes the acknowledged stash", async () => {
    persist.mockResolvedValue("persisted");
    useTaskDraftStore.getState().addPromptStash("task", {
      id: "stash-1",
      text: "restored prompt",
      createdAt: 1
    });

    await expect(restoreComposerPromptStash("task", "stash-1")).resolves.toEqual({
      status: "restored",
      text: "restored prompt"
    });
    expect(useTaskDraftStore.getState().drafts.task).toMatchObject({
      text: "restored prompt",
      promptStash: []
    });
  });

  it("keeps the restored item in the stash when removal is not acknowledged", async () => {
    persist.mockResolvedValueOnce("persisted");
    persistRemoval.mockResolvedValueOnce("failed");
    useTaskDraftStore.getState().addPromptStash("task", {
      id: "stash-1",
      text: "restored prompt",
      createdAt: 1
    });

    await expect(restoreComposerPromptStash("task", "stash-1"))
      .resolves.toEqual({ status: "persistence-failed" });
    expect(useTaskDraftStore.getState().drafts.task).toMatchObject({
      text: "restored prompt",
      promptStash: [{ id: "stash-1", text: "restored prompt", createdAt: 1 }]
    });
  });

  it("durably stashes image-only input before clearing and releasing live staging ids", async () => {
    persist.mockResolvedValue("persisted");
    storeImages.mockImplementation(async (request: { itemId: string }) => ({
      itemId: request.itemId,
      attachments: [{
        blobId: "blob-a",
        name: "screen.png",
        mimeType: "image/png",
        byteLength: 8,
        kind: "image"
      }]
    }));
    useTaskDraftStore.getState().setAttachments("task", [{
      id: "attachment-a",
      identity: "source-a",
      name: "screen.png",
      mimeType: "image/png",
      byteLength: 8,
      kind: "image"
    }]);

    await expect(stashComposerPrompt("task", "workspace-a")).resolves.toEqual({ status: "stashed" });
    expect(storeImages).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-a",
      taskId: "task",
      attachmentIds: ["attachment-a"]
    }));
    expect(useTaskDraftStore.getState().drafts.task).toMatchObject({
      text: "",
      attachments: [],
      promptStash: [{ text: "", attachments: [{ blobId: "blob-a" }] }]
    });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(releaseAttachments).toHaveBeenCalledWith(["attachment-a"]);
  });

  it("restores encrypted image metadata to fresh staging ids and then removes the encrypted item", async () => {
    persist.mockResolvedValue("persisted");
    restoreImages.mockResolvedValue({
      itemId: "stash-image",
      attachments: [{
        id: "attachment-restored",
        name: "screen.png",
        mimeType: "image/png",
        byteLength: 8,
        kind: "image"
      }]
    });
    deleteImages.mockResolvedValue(undefined);
    useTaskDraftStore.getState().addPromptStash("task", {
      id: "stash-image",
      text: "inspect image",
      createdAt: 1,
      attachments: [{
        blobId: "blob-a",
        name: "screen.png",
        mimeType: "image/png",
        byteLength: 8,
        kind: "image"
      }]
    });

    await expect(restoreComposerPromptStash("task", "stash-image")).resolves.toEqual({
      status: "restored",
      text: "inspect image"
    });
    expect(useTaskDraftStore.getState().drafts.task).toMatchObject({
      text: "inspect image",
      attachments: [{ id: "attachment-restored", identity: "stash:stash-image:attachment-restored" }],
      promptStash: []
    });
    expect(deleteImages).toHaveBeenCalledWith({ taskId: "task", itemId: "stash-image" });
  });

  it("rejects non-image attachments without clearing or persisting anything", async () => {
    useTaskDraftStore.getState().setText("task", "keep document");
    useTaskDraftStore.getState().setAttachments("task", [{
      id: "document-a",
      identity: "source-document",
      name: "notes.txt",
      mimeType: "text/plain",
      byteLength: 4,
      kind: "document"
    }]);

    await expect(stashComposerPrompt("task", "workspace-a"))
      .resolves.toEqual({ status: "unsupported-attachments" });
    expect(useTaskDraftStore.getState().drafts.task).toMatchObject({
      text: "keep document",
      attachments: [{ id: "document-a" }],
      promptStash: []
    });
    expect(storeImages).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("reports cleanup failure only after the stash record has been durably deleted", async () => {
    deleteImages.mockRejectedValue(new Error("locked"));
    useTaskDraftStore.getState().addPromptStash("task", {
      id: "stash-image",
      text: "delete me",
      createdAt: 1,
      attachments: [{
        blobId: "blob-a",
        name: "screen.png",
        mimeType: "image/png",
        byteLength: 8,
        kind: "image"
      }]
    });

    await expect(deleteComposerPromptStash("task", "stash-image")).resolves.toEqual({
      status: "cleanup-failed",
      completed: "deleted"
    });
    expect(useTaskDraftStore.getState().drafts.task?.promptStash).toEqual([]);
    expect(persistRemoval).toHaveBeenCalledWith("task", "stash-image");
  });

  it("restores the item when its removal is not durably acknowledged", async () => {
    persistRemoval.mockResolvedValueOnce("failed");
    useTaskDraftStore.getState().addPromptStash("task", {
      id: "only-stash",
      text: "keep until deletion is durable",
      createdAt: 1
    });

    await expect(deleteComposerPromptStash("task", "only-stash"))
      .resolves.toEqual({ status: "persistence-failed" });
    expect(useTaskDraftStore.getState().drafts.task?.promptStash).toEqual([{
      id: "only-stash",
      text: "keep until deletion is durable",
      createdAt: 1
    }]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
