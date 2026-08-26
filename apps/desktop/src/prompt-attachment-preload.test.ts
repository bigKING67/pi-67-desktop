import { describe, expect, it, vi } from "vitest";
import { MAX_PROMPT_PATHLESS_ATTACHMENT_BYTES } from "@pi67/protocol";
import { stagePromptAttachmentsFromPreload } from "./prompt-attachment-preload.js";

describe("prompt attachment preload staging", () => {
  it("sends one bounded pathless payload per IPC request", async () => {
    let activeInvocations = 0;
    let maximumActiveInvocations = 0;
    const invoke = vi.fn(async (channel: string, value: unknown) => {
      expect(channel).toBe("pi67:prompt-attachments-stage");
      activeInvocations += 1;
      maximumActiveInvocations = Math.max(maximumActiveInvocations, activeInvocations);
      await Promise.resolve();
      activeInvocations -= 1;
      const candidate = (value as Array<Record<string, unknown>>)[0]!;
      return [{
        id: `staged_${String(candidate.name).replace(/[^A-Za-z0-9_-]/gu, "_")}`,
        name: candidate.name,
        mimeType: candidate.mimeType,
        byteLength: candidate.byteLength,
        kind: "document"
      }];
    });
    const first = file("first.txt", 4);
    const second = file("second.txt", 5);

    await expect(stagePromptAttachmentsFromPreload([first.value, second.value], {
      getPathForFile: () => "",
      invoke
    })).resolves.toHaveLength(2);

    expect(first.arrayBuffer).toHaveBeenCalledOnce();
    expect(second.arrayBuffer).toHaveBeenCalledOnce();
    expect(maximumActiveInvocations).toBe(1);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("releases earlier staged items when a later IPC request fails", async () => {
    const invoke = vi.fn(async (channel: string, value: unknown) => {
      if (channel === "pi67:prompt-attachments-release") return undefined;
      const candidate = (value as Array<Record<string, unknown>>)[0]!;
      if (candidate.name === "second.txt") throw new Error("stage failed");
      return [{
        id: "staged_first",
        name: candidate.name,
        mimeType: candidate.mimeType,
        byteLength: candidate.byteLength,
        kind: "document"
      }];
    });

    await expect(stagePromptAttachmentsFromPreload([
      file("first.txt", 4).value,
      file("second.txt", 5).value
    ], {
      getPathForFile: () => "",
      invoke
    })).rejects.toThrow("stage failed");

    expect(invoke).toHaveBeenLastCalledWith("pi67:prompt-attachments-release", ["staged_first"]);
  });

  it("rejects an oversized pathless file before reading or invoking IPC", async () => {
    const selected = file("large.bin", MAX_PROMPT_PATHLESS_ATTACHMENT_BYTES + 1);
    const invoke = vi.fn(async () => undefined);

    await expect(stagePromptAttachmentsFromPreload([selected.value], {
      getPathForFile: () => "",
      invoke
    })).rejects.toThrow("16 MiB clipboard attachment limit");

    expect(selected.arrayBuffer).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("accepts only an exact source binding for HEIC-to-JPEG normalization", async () => {
    const selected = file("camera.heic", 12, "image/heic");
    const invoke = vi.fn(async () => [{
      id: "normalized_camera",
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

    await expect(stagePromptAttachmentsFromPreload([selected.value], {
      getPathForFile: () => "/private/camera.heic",
      invoke
    })).resolves.toEqual([expect.objectContaining({
      name: "camera.jpg",
      mimeType: "image/jpeg",
      byteLength: 8
    })]);
    expect(selected.arrayBuffer).not.toHaveBeenCalled();

    invoke.mockResolvedValueOnce([{
      id: "forged_camera",
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
    await expect(stagePromptAttachmentsFromPreload([selected.value], {
      getPathForFile: () => "/private/camera.heic",
      invoke
    })).rejects.toThrow("does not match");
  });
});

function file(name: string, size: number, type = "text/plain") {
  const arrayBuffer = vi.fn(async () => new ArrayBuffer(size));
  return {
    arrayBuffer,
    value: {
      name,
      type,
      size,
      lastModified: 1,
      arrayBuffer
    }
  };
}
