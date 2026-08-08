import { describe, expect, it } from "vitest";
import {
  isPromptStashImagesRestoreResult,
  isPromptStashImagesStoreResult,
  parsePromptStashImagesRestoreRequest,
  parsePromptStashImagesStoreRequest
} from "./prompt-stash-images.js";

describe("Prompt Stash image protocol", () => {
  it("accepts only bounded opaque store and restore requests", () => {
    const store = {
      workspaceId: "workspace-a",
      taskId: "task-a",
      itemId: "stash-a",
      attachmentIds: ["attachment-a", "attachment-b"]
    };
    expect(parsePromptStashImagesStoreRequest(store)).toEqual(store);
    expect(parsePromptStashImagesStoreRequest({ ...store, attachmentIds: ["attachment-a", "attachment-a"] }))
      .toBeUndefined();
    expect(parsePromptStashImagesStoreRequest({ ...store, itemId: "../outside" })).toBeUndefined();
    expect(parsePromptStashImagesStoreRequest({ ...store, path: "/tmp/payload" })).toBeUndefined();

    expect(parsePromptStashImagesRestoreRequest({ taskId: "task-a", itemId: "stash-a" }))
      .toEqual({ taskId: "task-a", itemId: "stash-a" });
    expect(parsePromptStashImagesRestoreRequest({ taskId: "task-a", itemId: "../outside" })).toBeUndefined();
    expect(parsePromptStashImagesRestoreRequest({ taskId: "task-a", itemId: "stash-a", bytes: "raw" }))
      .toBeUndefined();
  });

  it("validates public encrypted-store metadata without accepting bytes or duplicate blobs", () => {
    const attachment = {
      blobId: "blob-a",
      name: "screen.png",
      mimeType: "image/png",
      byteLength: 4,
      kind: "image"
    } as const;
    expect(isPromptStashImagesStoreResult({ itemId: "stash-a", attachments: [attachment] })).toBe(true);
    expect(isPromptStashImagesStoreResult({ itemId: "stash-a", attachments: [attachment, attachment] })).toBe(false);
    expect(isPromptStashImagesStoreResult({
      itemId: "stash-a",
      attachments: [{ ...attachment, mimeType: "image/svg+xml" }]
    })).toBe(false);
    expect(isPromptStashImagesStoreResult({
      itemId: "stash-a",
      attachments: [{ ...attachment, kind: "document" }]
    })).toBe(false);
    expect(isPromptStashImagesStoreResult({
      itemId: "stash-a",
      attachments: [{ ...attachment, data: "iVBORw==" }]
    })).toBe(false);
  });

  it("accepts only fresh staged-image restore metadata", () => {
    const attachment = {
      id: "attachment-restored",
      name: "screen.webp",
      mimeType: "image/webp",
      byteLength: 8,
      kind: "image"
    } as const;
    expect(isPromptStashImagesRestoreResult({ itemId: "stash-a", attachments: [attachment] })).toBe(true);
    expect(isPromptStashImagesRestoreResult({
      itemId: "stash-a",
      attachments: [{ ...attachment, id: "../outside" }]
    })).toBe(false);
    expect(isPromptStashImagesRestoreResult({
      itemId: "stash-a",
      attachments: [{ ...attachment, previewUrl: "data:image/webp;base64,raw" }]
    })).toBe(false);
  });
});
