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
      streamBehavior: "steer"
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
