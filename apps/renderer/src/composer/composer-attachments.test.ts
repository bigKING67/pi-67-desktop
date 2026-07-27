import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDraftAttachments,
  filesFromTransfer,
  removeDraftAttachment,
  revokeDraftAttachments,
  toTransferImages,
  transferContainsFiles
} from "./composer-attachments.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Composer attachments", () => {
  it("creates bounded object URL projections and rejects duplicate files", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:first");
    const file = imageFile("draft.png", 8);
    const attachments = createDraftAttachments([file], []);

    expect(attachments).toMatchObject([{
      file: { name: "draft.png", size: 8, type: "image/png" },
      previewUrl: "blob:first"
    }]);
    expect(() => createDraftAttachments([imageFile("draft.png", 8)], attachments))
      .toThrow("draft.png 已经添加。");
    revokeDraftAttachments(attachments);
  });

  it("revokes removed previews and transfers bytes only when requested", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:transfer");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const [attachment] = createDraftAttachments([imageFile("transfer.webp", 4, "image/webp")], []);
    if (!attachment) throw new Error("Expected one attachment.");

    const transfer = await toTransferImages([attachment]);
    expect(transfer).toMatchObject([{ name: "transfer.webp", mimeType: "image/webp" }]);
    expect([...new Uint8Array(transfer[0]?.data ?? new ArrayBuffer(0))]).toEqual([1, 1, 1, 1]);
    expect(removeDraftAttachment([attachment], attachment.id)).toEqual([]);
    expect(revoke).toHaveBeenCalledWith("blob:transfer");
  });

  it("extracts only file items from clipboard and drag transfers", () => {
    const file = imageFile("clipboard.png", 3);
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
});

function imageFile(name: string, size: number, type = "image/png"): File {
  return new File([new Uint8Array(size).fill(1)], name, { lastModified: 1, type });
}
