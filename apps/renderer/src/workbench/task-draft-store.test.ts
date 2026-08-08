import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftAttachment } from "../composer/composer-attachments.js";
import { useTaskDraftStore } from "./task-draft-store.js";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const releasePromptAttachments = vi.fn(async (_ids: string[]) => undefined);

describe("task draft store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    releasePromptAttachments.mockClear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { pi67: { system: { releasePromptAttachments } } }
    });
    useTaskDraftStore.getState().dispose();
    releasePromptAttachments.mockClear();
  });

  afterEach(() => {
    useTaskDraftStore.getState().dispose();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  it("reports empty without creating a target draft", () => {
    expect(useTaskDraftStore.getState().transfer("source", "target")).toBe("empty");
    expect(useTaskDraftStore.getState().drafts).toEqual({});
  });

  it("moves text and attachments atomically without releasing staged assets", () => {
    const attachment = draftAttachment();
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const store = useTaskDraftStore.getState();
    store.setText("source", "preserve this draft");
    store.setAttachments("source", [attachment]);
    store.setStreamBehavior("source", "steer");

    expect(useTaskDraftStore.getState().transfer("source", "target")).toBe("moved");

    expect(useTaskDraftStore.getState().drafts["source"]).toBeUndefined();
    expect(useTaskDraftStore.getState().drafts["target"]).toEqual({
      text: "preserve this draft",
      attachments: [attachment],
      workspaceFiles: [],
      promptStash: [],
      streamBehavior: "steer",
      interactionMode: "execute"
    });
    expect(revoke).not.toHaveBeenCalled();
    expect(releasePromptAttachments).not.toHaveBeenCalled();
  });

  it("keeps both drafts when the target already has content", () => {
    const store = useTaskDraftStore.getState();
    store.setText("source", "source draft");
    store.setText("target", "target draft");

    expect(useTaskDraftStore.getState().transfer("source", "target")).toBe("conflict");
    expect(useTaskDraftStore.getState().drafts["source"]?.text).toBe("source draft");
    expect(useTaskDraftStore.getState().drafts["target"]?.text).toBe("target draft");
  });

  it("fails closed when source and target are the same Task", () => {
    useTaskDraftStore.getState().setText("source", "keep me");

    expect(useTaskDraftStore.getState().transfer("source", "source")).toBe("conflict");
    expect(useTaskDraftStore.getState().drafts["source"]?.text).toBe("keep me");
  });

  it("restores persisted text without replacing a live draft", () => {
    expect(useTaskDraftStore.getState().restore("task-a", {
      text: "restored",
      streamBehavior: "steer"
    })).toBe("restored");
    expect(useTaskDraftStore.getState().drafts["task-a"]).toEqual({
      text: "restored",
      attachments: [],
      workspaceFiles: [],
      promptStash: [],
      streamBehavior: "steer",
      interactionMode: "execute"
    });

    useTaskDraftStore.getState().setText("task-a", "live");
    expect(useTaskDraftStore.getState().restore("task-a", {
      text: "stale",
      streamBehavior: "followUp"
    })).toBe("conflict");
    expect(useTaskDraftStore.getState().drafts["task-a"]?.text).toBe("live");
  });

  it("does not replace a newer live clear or stream-mode change during hydration", () => {
    useTaskDraftStore.getState().setText("task-b", "");
    useTaskDraftStore.getState().setStreamBehavior("task-b", "steer");

    expect(useTaskDraftStore.getState().restore("task-b", {
      text: "stale persisted text",
      streamBehavior: "followUp"
    })).toBe("conflict");
    expect(useTaskDraftStore.getState().drafts["task-b"]).toEqual({
      text: "",
      attachments: [],
      workspaceFiles: [],
      promptStash: [],
      streamBehavior: "steer",
      interactionMode: "execute"
    });
  });

  it("moves and restores Workspace file references without treating them as attachment bytes", () => {
    const reference = {
      id: "file-a",
      revision: "revision-a",
      relativePath: "src/main.ts"
    };
    const store = useTaskDraftStore.getState();
    store.setText("source", "inspect @[src/main.ts]");
    store.setWorkspaceFiles("source", [reference]);

    expect(store.transfer("source", "target")).toBe("moved");
    expect(useTaskDraftStore.getState().drafts.target?.workspaceFiles).toEqual([reference]);
    useTaskDraftStore.getState().discard("target");
    expect(releasePromptAttachments).not.toHaveBeenCalled();

    expect(useTaskDraftStore.getState().restore("restored", {
      text: "inspect @[src/main.ts]",
      streamBehavior: "followUp",
      workspaceFiles: [reference]
    })).toBe("restored");
    expect(useTaskDraftStore.getState().drafts.restored?.workspaceFiles).toEqual([reference]);
  });

  it("rejects Prompt stash entries that cannot fit the encrypted persistence contract", () => {
    const store = useTaskDraftStore.getState();
    expect(store.addPromptStash("task", {
      id: "oversized",
      text: "x".repeat(256 * 1024 + 1),
      createdAt: 1
    })).toBe("too-large");
    expect(useTaskDraftStore.getState().drafts.task).toBeUndefined();

    for (let index = 0; index < 8; index += 1) {
      expect(useTaskDraftStore.getState().addPromptStash("task", {
        id: `stash-${index}`,
        text: `${index}${"x".repeat(256 * 1024 - 1)}`,
        createdAt: index
      })).toBe("added");
    }
    expect(useTaskDraftStore.getState().addPromptStash("task", {
      id: "stash-over-total",
      text: "last byte",
      createdAt: 9
    })).toBe("too-large");
    expect(useTaskDraftStore.getState().drafts.task?.promptStash).toHaveLength(8);
  });
});

function draftAttachment(): DraftAttachment {
  return {
    id: "attachment-a",
    name: "draft.png",
    mimeType: "image/png",
    byteLength: 1,
    kind: "image",
    identity: ["draft.png", "image/png", "1", "1"].join("\0"),
    previewUrl: "blob:draft"
  };
}
