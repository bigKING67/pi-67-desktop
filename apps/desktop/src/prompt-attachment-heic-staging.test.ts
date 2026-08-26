import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { PromptAttachmentStagingService } from "./prompt-attachment-staging.js";
import {
  attachmentCandidate as candidate,
  bufferCandidate,
  draftDirectories
} from "./prompt-attachment-staging-test-fixture.js";
import type { PromptImageNormalizer } from "./prompt-image-normalization-client.js";
import { heifFixture, jpegFixture } from "./prompt-image-test-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PromptAttachmentStagingService HEIC normalization", () => {
  it("normalizes content-identified HEIC into metadata-free staged JPEG bytes", async () => {
    const jpeg = jpegFixture(4_032, 3_024);
    const normalizer = fakeNormalizer({
      bytes: Buffer.from(jpeg),
      width: 4_032,
      height: 3_024
    });
    const fixture = await createFixture(normalizer);
    const heic = heifFixture(4_032, 3_024);

    const [attachment] = await fixture.service.stage([candidate({
      name: "IMG_0067.heic",
      mimeType: "image/heic",
      byteLength: heic.byteLength,
      data: Uint8Array.from(heic).buffer
    })]);

    expect(attachment).toMatchObject({
      name: "IMG_0067.jpg",
      mimeType: "image/jpeg",
      byteLength: jpeg.byteLength,
      kind: "image",
      normalization: {
        kind: "heic-to-jpeg",
        sourceName: "IMG_0067.heic",
        sourceMimeType: "image/heic",
        sourceByteLength: heic.byteLength
      }
    });
    expect(normalizer.normalizeMock).toHaveBeenCalledOnce();
    const directory = join(fixture.service.draftRoot, attachment!.id);
    expect(await readFile(join(directory, "payload.bin"))).toEqual(Buffer.from(jpeg));
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      version: 1,
      name: "IMG_0067.jpg",
      mimeType: "image/jpeg",
      byteLength: jpeg.byteLength,
      kind: "image"
    });
    expect(manifest).not.toHaveProperty("normalization");
  });

  it("fails closed for HEIC claims without matching content and preserves earlier draft items", async () => {
    const normalizer = fakeNormalizer({
      bytes: Buffer.from(jpegFixture(10, 10)),
      width: 10,
      height: 10
    });
    const fixture = await createFixture(normalizer);
    const [existing] = await fixture.service.stage([bufferCandidate("existing.png", [
      0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4
    ])]);

    await expect(fixture.service.stage([candidate({
      name: "broken.heic",
      mimeType: "image/heic",
      byteLength: 4,
      data: Uint8Array.from([1, 2, 3, 4]).buffer
    })])).rejects.toThrow("无法从文件内容确认");

    expect(normalizer.normalizeMock).not.toHaveBeenCalled();
    expect(await draftDirectories(fixture.service.draftRoot)).toEqual([existing!.id]);
  });
});

async function createFixture(normalizer: PromptImageNormalizer): Promise<{
  parent: string;
  service: PromptAttachmentStagingService;
}> {
  const parent = await mkdtemp(join(tmpdir(), "pi67-attachment-heic-staging-"));
  roots.push(parent);
  return {
    parent,
    service: new PromptAttachmentStagingService(join(parent, "run"), { normalizer })
  };
}

function fakeNormalizer(
  result: Awaited<ReturnType<PromptImageNormalizer["normalize"]>>
): PromptImageNormalizer & { normalizeMock: Mock } {
  const normalizeMock = vi.fn(async () => result);
  return {
    normalize: normalizeMock,
    normalizeMock,
    dispose: vi.fn(async () => undefined)
  };
}
