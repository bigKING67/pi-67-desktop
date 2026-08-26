import type { Page } from "@playwright/test";
import type {
  DesktopSystemBridge,
  DesktopPromptAttachmentInput,
  PromptStashImageRef,
  PromptStashImagesDeleteRequest,
  PromptStashImagesRestoreRequest,
  PromptStashImagesStoreRequest,
  StagedPromptAttachment,
  StagedPromptAttachmentResult
} from "@pi67/protocol";

export type MockDesktopAttachmentBridge = Pick<DesktopSystemBridge,
  | "stagePromptAttachments"
  | "releasePromptAttachments"
  | "storePromptStashImages"
  | "restorePromptStashImages"
  | "deletePromptStashImages"
>;

export async function installMockDesktopAttachmentBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type SystemFixtureRegistry = { methods: Partial<DesktopSystemBridge> };
    const fixtureWindow = window as unknown as { __pi67SystemFixture?: SystemFixtureRegistry };
    const systemFixture = fixtureWindow.__pi67SystemFixture ??= { methods: {} };
    let promptAttachmentCounter = 0;
    let promptStashBlobCounter = 0;
    const stagedPromptAttachments = new Map<string, StagedPromptAttachment>();
    const promptStashImages = new Map<string, PromptStashImageRef[]>();

    const attachmentBridge = {
      stagePromptAttachments: async (files: DesktopPromptAttachmentInput[]) => files.map((file) => {
        if (file.name === "fixture-decode-failure.heic") {
          throw new Error("无法解码该 HEIC/HEIF 图片，草稿已保留，可以重新选择重试。");
        }
        const normalized = /\.(?:heic|heif)$/iu.test(file.name)
          || file.type === "image/heic" || file.type === "image/heif";
        const attachment: StagedPromptAttachmentResult = {
          id: `fixture_attachment_${++promptAttachmentCounter}`,
          name: normalized ? file.name.replace(/\.[^.]+$/u, ".jpg") : file.name,
          mimeType: normalized ? "image/jpeg" : file.type || "application/octet-stream",
          byteLength: normalized ? Math.max(1, file.size - 1) : file.size,
          kind: normalized ? "image" : promptAttachmentKind(file),
          ...(normalized ? {
            normalization: {
              kind: "heic-to-jpeg",
              sourceName: file.name,
              sourceMimeType: file.type,
              sourceByteLength: file.size
            }
          } : {})
        };
        stagedPromptAttachments.set(attachment.id, attachment);
        return structuredClone(attachment);
      }),
      releasePromptAttachments: async (ids: string[]) => {
        for (const id of ids) stagedPromptAttachments.delete(id);
      },
      storePromptStashImages: async (request: PromptStashImagesStoreRequest) => {
        const key = `${request.taskId}\0${request.itemId}`;
        if (!promptStashImages.has(key) && promptStashImages.size >= 20) {
          throw new Error("Mock Prompt Stash image capacity was reached.");
        }
        const attachments = request.attachmentIds.map((id) => {
          const attachment = stagedPromptAttachments.get(id);
          if (!attachment || attachment.kind !== "image") {
            throw new Error(`Mock staged image ${id} was not found.`);
          }
          return {
            blobId: `fixture_stash_blob_${++promptStashBlobCounter}`,
            name: attachment.name,
            mimeType: attachment.mimeType as PromptStashImageRef["mimeType"],
            byteLength: attachment.byteLength,
            kind: "image" as const
          };
        });
        promptStashImages.set(key, structuredClone(attachments));
        return { itemId: request.itemId, attachments };
      },
      restorePromptStashImages: async (request: PromptStashImagesRestoreRequest) => {
        const attachments = promptStashImages.get(`${request.taskId}\0${request.itemId}`);
        if (!attachments) throw new Error("Mock Prompt Stash image item was not found.");
        return {
          itemId: request.itemId,
          attachments: attachments.map((attachment) => {
            const staged = {
              id: `fixture_attachment_${++promptAttachmentCounter}`,
              name: attachment.name,
              mimeType: attachment.mimeType,
              byteLength: attachment.byteLength,
              kind: "image" as const
            };
            stagedPromptAttachments.set(staged.id, staged);
            return staged;
          })
        };
      },
      deletePromptStashImages: async (request: PromptStashImagesDeleteRequest) => {
        promptStashImages.delete(`${request.taskId}\0${request.itemId}`);
      }
    } satisfies MockDesktopAttachmentBridge;
    Object.assign(systemFixture.methods, attachmentBridge);

    function promptAttachmentKind(file: DesktopPromptAttachmentInput): StagedPromptAttachment["kind"] {
      const type = file.type.toLowerCase();
      const name = file.name.toLowerCase();
      if (type.startsWith("image/")) return "image";
      if (type.startsWith("audio/")) return "audio";
      if (type.startsWith("video/")) return "video";
      if (/zip|gzip|tar|7z|rar/u.test(type) || /\.(?:zip|tar|tgz|gz)$/u.test(name)) return "archive";
      if (type.startsWith("text/") || /pdf|word|excel|spreadsheet|presentation|opendocument|rtf|epub/u.test(type)) {
        return "document";
      }
      return "file";
    }
  });
}
