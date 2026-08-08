import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistTaskDraftStateAcknowledged } from "../workbench/task-draft-persistence.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import {
  restoreComposerPromptStash,
  stashComposerPrompt
} from "./prompt-stash-controller.js";

vi.mock("../workbench/task-draft-persistence.js", () => ({
  persistTaskDraftStateAcknowledged: vi.fn()
}));

const persist = vi.mocked(persistTaskDraftStateAcknowledged);

describe("Prompt stash controller", () => {
  beforeEach(() => {
    persist.mockReset();
    useTaskDraftStore.getState().dispose();
  });

  it("does not clear the Composer until encrypted persistence acknowledges the stash", async () => {
    const acknowledgement = deferred<boolean>();
    persist.mockReturnValueOnce(acknowledgement.promise).mockResolvedValueOnce(true);
    useTaskDraftStore.getState().setText("task", "keep this prompt");

    const result = stashComposerPrompt("task");
    expect(useTaskDraftStore.getState().drafts.task?.text).toBe("keep this prompt");
    expect(useTaskDraftStore.getState().drafts.task?.promptStash).toHaveLength(1);

    acknowledgement.resolve(true);
    await expect(result).resolves.toEqual({ status: "stashed" });
    expect(useTaskDraftStore.getState().drafts.task?.text).toBe("");
  });

  it("preserves exact text and never clears a newer Composer edit", async () => {
    const acknowledgement = deferred<boolean>();
    persist.mockReturnValueOnce(acknowledgement.promise);
    useTaskDraftStore.getState().setText("task", "  keep spacing\n");

    const result = stashComposerPrompt("task");
    useTaskDraftStore.getState().setText("task", "newer edit");
    acknowledgement.resolve(true);

    await expect(result).resolves.toEqual({ status: "stashed" });
    expect(useTaskDraftStore.getState().drafts.task).toMatchObject({
      text: "newer edit",
      promptStash: [{ text: "  keep spacing\n" }]
    });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("clears a duplicate only after confirming the existing stash", async () => {
    persist.mockResolvedValue(true);
    useTaskDraftStore.getState().addPromptStash("task", {
      id: "existing",
      text: "same prompt",
      createdAt: 1
    });
    useTaskDraftStore.getState().setText("task", "same prompt");

    await expect(stashComposerPrompt("task")).resolves.toEqual({ status: "stashed" });
    expect(useTaskDraftStore.getState().drafts.task).toMatchObject({
      text: "",
      promptStash: [{ id: "existing", text: "same prompt", createdAt: 1 }]
    });
  });

  it("keeps the original text and rolls back a new stash item when persistence fails", async () => {
    persist.mockResolvedValueOnce(false);
    useTaskDraftStore.getState().setText("task", "never lose this");

    await expect(stashComposerPrompt("task")).resolves.toEqual({ status: "persistence-failed" });
    expect(useTaskDraftStore.getState().drafts.task?.text).toBe("never lose this");
    expect(useTaskDraftStore.getState().drafts.task?.promptStash).toEqual([]);
  });

  it("restores the original text when clearing it cannot be acknowledged", async () => {
    persist.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    useTaskDraftStore.getState().setText("task", "durable before clear");

    await expect(stashComposerPrompt("task")).resolves.toEqual({ status: "persistence-failed" });
    expect(useTaskDraftStore.getState().drafts.task).toMatchObject({
      text: "durable before clear",
      promptStash: [{ text: "durable before clear" }]
    });
  });

  it("restores only into an empty Composer and removes the acknowledged stash", async () => {
    persist.mockResolvedValue(true);
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
    persist.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
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
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
