import type { AuthorizedIpcHandle } from "./authorized-ipc.js";
import {
  isPromptStashImagesRestoreResult,
  isPromptStashImagesStoreResult,
  parsePromptStashImagesRestoreRequest,
  parsePromptStashImagesStoreRequest
} from "@pi67/protocol";
import type { PromptAttachmentStagingService } from "./prompt-attachment-staging.js";
import type { PromptStashImageStore } from "./prompt-stash-image-store.js";

export function registerPromptInputBridge(
  handle: AuthorizedIpcHandle,
  promptAttachments: PromptAttachmentStagingService,
  promptStashImages: PromptStashImageStore
): void {
  handle("pi67:prompt-attachments-stage", (_event, value: unknown) => promptAttachments.stage(value));
  handle("pi67:prompt-attachments-release", (_event, value: unknown) => promptAttachments.release(value));
  handle("pi67:prompt-stash-images-store", async (_event, value: unknown) => {
    const request = parsePromptStashImagesStoreRequest(value);
    if (!request) throw new Error("Prompt Stash image store request is invalid.");
    const result = await promptStashImages.store(request);
    if (!isPromptStashImagesStoreResult(result)) throw new Error("Prompt Stash image store result is invalid.");
    return result;
  });
  handle("pi67:prompt-stash-images-restore", async (_event, value: unknown) => {
    const request = parsePromptStashImagesRestoreRequest(value);
    if (!request) throw new Error("Prompt Stash image restore request is invalid.");
    const result = await promptStashImages.restore(request);
    if (!isPromptStashImagesRestoreResult(result)) throw new Error("Prompt Stash image restore result is invalid.");
    return result;
  });
  handle("pi67:prompt-stash-images-delete", async (_event, value: unknown) => {
    const request = parsePromptStashImagesRestoreRequest(value);
    if (!request) throw new Error("Prompt Stash image delete request is invalid.");
    await promptStashImages.delete(request);
  });
}
