import {
  MAX_PROMPT_ATTACHMENT_BYTES,
  MAX_PROMPT_ATTACHMENT_COUNT,
  MAX_PROMPT_ATTACHMENT_TOTAL_BYTES,
  MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES,
  type PromptAttachmentKind,
  type StagedPromptAttachment,
  type StagedPromptAttachmentResult
} from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DraftAttachment,
  filesFromTransfer,
  removeDraftAttachment,
  revokeDraftAttachments,
  stageDraftAttachments,
  transferContainsFiles
} from "./composer-attachments.js";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const stagePromptAttachments = vi.fn<(files: File[]) => Promise<StagedPromptAttachmentResult[]>>(
  async (files: File[]) => files.map(stagedAttachment)
);
const releasePromptAttachments = vi.fn(async (_ids: string[]) => undefined);

beforeEach(() => {
  stagePromptAttachments.mockClear();
  releasePromptAttachments.mockClear();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      pi67: {
        system: { stagePromptAttachments, releasePromptAttachments }
      }
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("Composer attachments", () => {
  it("stages ordinary files without loading them into Renderer object URLs", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL");
    const file = attachmentFile("requirements.pdf", 8, "application/pdf");

    const attachments = await stageDraftAttachments([file], []);

    expect(stagePromptAttachments).toHaveBeenCalledWith([file]);
    expect(attachments).toEqual([{
      id: "staged:requirements.pdf",
      name: "requirements.pdf",
      mimeType: "application/pdf",
      byteLength: 8,
      kind: "document",
      identity: ["requirements.pdf", "application/pdf", "8", "1"].join("\0")
    }]);
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("creates previews only for images and releases staged ids when removed", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const [attachment] = await stageDraftAttachments([
      attachmentFile("draft.webp", 4, "image/webp")
    ], []);
    if (!attachment) throw new Error("Expected one attachment.");

    expect(attachment.previewUrl).toBe("blob:preview");
    expect(removeDraftAttachment([attachment], attachment.id)).toEqual([]);
    expect(revoke).toHaveBeenCalledWith("blob:preview");
    expect(releasePromptAttachments).toHaveBeenCalledWith([attachment.id]);
  });

  it("accepts normalized HEIC source binding without exposing the original HEIC blob", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL");
    const source = attachmentFile("camera.heic", 12, "image/heic");
    stagePromptAttachments.mockResolvedValueOnce([{
      id: "normalized-camera",
      name: "camera.jpg",
      mimeType: "image/jpeg",
      byteLength: 8,
      kind: "image",
      normalization: {
        kind: "heic-to-jpeg",
        sourceName: "camera.heic",
        sourceMimeType: "image/heic",
        sourceByteLength: 12
      }
    }]);

    await expect(stageDraftAttachments([source], [])).resolves.toEqual([{
      id: "normalized-camera",
      name: "camera.jpg",
      mimeType: "image/jpeg",
      byteLength: 8,
      kind: "image",
      identity: ["camera.heic", "image/heic", "12", "1"].join("\0")
    }]);
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("rejects forged normalization binding and leaves the existing draft unchanged", async () => {
    const current: DraftAttachment[] = [{
      id: "existing",
      name: "existing.txt",
      mimeType: "text/plain",
      byteLength: 4,
      kind: "document",
      identity: "existing"
    }];
    stagePromptAttachments.mockResolvedValueOnce([{
      id: "forged-camera",
      name: "camera.jpg",
      mimeType: "image/jpeg",
      byteLength: 8,
      kind: "image",
      normalization: {
        kind: "heic-to-jpeg",
        sourceName: "other.heic",
        sourceMimeType: "image/heic",
        sourceByteLength: 12
      }
    }]);

    await expect(stageDraftAttachments([
      attachmentFile("camera.heic", 12, "image/heic")
    ], current)).rejects.toThrow("不一致");
    expect(current).toHaveLength(1);
    expect(releasePromptAttachments).toHaveBeenCalledWith(["forged-camera"]);
  });

  it("rejects duplicates and bounded-count or byte-limit violations before staging", async () => {
    const file = attachmentFile("duplicate.txt", 8, "text/plain");
    const current = await stageDraftAttachments([file], []);
    stagePromptAttachments.mockClear();

    await expect(stageDraftAttachments([file], current)).rejects.toThrow("duplicate.txt 已经添加。");
    await expect(stageDraftAttachments(
      Array.from({ length: MAX_PROMPT_ATTACHMENT_COUNT + 1 }, (_, index) => (
        attachmentFile(`${index}.txt`, 1, "text/plain")
      )),
      []
    )).rejects.toThrow(`每条消息最多添加 ${MAX_PROMPT_ATTACHMENT_COUNT} 个附件。`);
    await expect(stageDraftAttachments([
      attachmentFile("large.bin", MAX_PROMPT_ATTACHMENT_BYTES + 1, "application/octet-stream")
    ], [])).rejects.toThrow("large.bin 超过单文件 100 MiB 限制。");
    await expect(stageDraftAttachments([
      attachmentFile("a.bin", MAX_PROMPT_ATTACHMENT_BYTES, "application/octet-stream"),
      attachmentFile("b.bin", MAX_PROMPT_ATTACHMENT_BYTES, "application/octet-stream"),
      attachmentFile("c.bin", MAX_PROMPT_ATTACHMENT_TOTAL_BYTES - 2 * MAX_PROMPT_ATTACHMENT_BYTES + 1, "application/octet-stream")
    ], [])).rejects.toThrow("附件总大小超过每条消息 250 MiB 限制。");
    expect(stagePromptAttachments).not.toHaveBeenCalled();
  });

  it("releases partial staging results without changing the current draft", async () => {
    stagePromptAttachments.mockResolvedValueOnce([{
      id: "partial",
      name: "first.txt",
      mimeType: "text/plain",
      byteLength: 1,
      kind: "document"
    }]);

    await expect(stageDraftAttachments([
      attachmentFile("first.txt", 1, "text/plain"),
      attachmentFile("second.txt", 1, "text/plain")
    ], [])).rejects.toThrow("附件暂存结果不完整，请重新选择。");
    expect(releasePromptAttachments).toHaveBeenCalledWith(["partial"]);
  });

  it("releases a newly staged image when authoritative metadata would overflow the full draft", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:new-image");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const current: DraftAttachment[] = [{
      id: "current-image",
      name: "current.png",
      mimeType: "image/png",
      byteLength: MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES,
      kind: "image",
      identity: "current-image"
    }];
    stagePromptAttachments.mockResolvedValueOnce([{
      id: "new-image",
      name: "next.png",
      mimeType: "image/png",
      byteLength: 1,
      kind: "image"
    }]);

    await expect(stageDraftAttachments([
      attachmentFile("next.png", 1, "image/png")
    ], current)).rejects.toThrow("图片总大小超过每条消息 32 MiB 限制。");

    expect(releasePromptAttachments).toHaveBeenCalledWith(["new-image"]);
    expect(current).toHaveLength(1);
  });

  it("extracts only file items from clipboard and drag transfers", () => {
    const file = attachmentFile("clipboard.png", 3, "image/png");
    const transfer = {
      files: [],
      items: [
        { getAsFile: () => null, kind: "string" },
        { getAsFile: () => file, kind: "file" }
      ],
      types: ["text/plain", "Files"]
    } as unknown as DataTransfer;

    expect(transferContainsFiles(transfer)).toBe(true);
    expect(filesFromTransfer(transfer)).toEqual([file]);
  });

  it("releases every retained draft id while revoking only image previews", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const attachments = await stageDraftAttachments([
      attachmentFile("image.png", 1, "image/png"),
      attachmentFile("notes.txt", 1, "text/plain")
    ], []);

    revokeDraftAttachments(attachments);

    expect(revoke).toHaveBeenCalledOnce();
    expect(releasePromptAttachments).toHaveBeenCalledWith(attachments.map(({ id }) => id));
  });
});

function attachmentFile(name: string, size: number, type: string): File {
  return {
    name,
    size,
    type,
    lastModified: 1
  } as File;
}

function stagedAttachment(file: File): StagedPromptAttachment {
  return {
    id: `staged:${file.name}`,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    byteLength: file.size,
    kind: attachmentKind(file.type)
  };
}

function attachmentKind(mimeType: string): PromptAttachmentKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/zip") return "archive";
  return mimeType === "text/plain" || mimeType === "application/pdf" ? "document" : "file";
}
