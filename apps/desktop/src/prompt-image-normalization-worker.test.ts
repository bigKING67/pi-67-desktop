import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executePromptImageNormalization } from "./prompt-image-normalization-worker.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("prompt image normalization worker", () => {
  it("checks descriptor dimensions before RGBA decode and returns exact encoded bytes", async () => {
    const fixture = await sourceFixture();
    const dispose = vi.fn();
    const decodeImage = vi.fn(async () => ({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(16)
    }));
    const dependencies = fakeDependencies({ width: 2, height: 2, decode: decodeImage }, dispose);

    await expect(executePromptImageNormalization({
      id: "image",
      sourcePath: fixture.path,
      sourceByteLength: fixture.bytes.byteLength
    }, dependencies as never)).resolves.toEqual({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
      width: 2,
      height: 2
    });
    expect(decodeImage).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("rejects a pixel bomb before allocating decoded RGBA bytes", async () => {
    const fixture = await sourceFixture();
    const dispose = vi.fn();
    const decodeImage = vi.fn();
    const dependencies = fakeDependencies({ width: 10_000, height: 5_001, decode: decodeImage }, dispose);

    await expect(executePromptImageNormalization({
      id: "bomb",
      sourcePath: fixture.path,
      sourceByteLength: fixture.bytes.byteLength
    }, dependencies as never)).rejects.toMatchObject({ code: "pixel_budget" });
    expect(decodeImage).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
});

async function sourceFixture(): Promise<{ path: string; bytes: Buffer }> {
  const root = await mkdtemp(join(tmpdir(), "pi67-heic-worker-"));
  roots.push(root);
  const path = join(root, "payload.bin");
  const bytes = Buffer.from([1, 2, 3, 4]);
  await writeFile(path, bytes);
  return { path, bytes };
}

function fakeDependencies(
  image: { width: number; height: number; decode: () => Promise<unknown> },
  dispose: () => void
) {
  const images = Object.assign([image], { dispose });
  return {
    decode: { all: vi.fn(async () => images) },
    canvas: {
      ImageData: class {
        constructor(
          readonly data: Uint8ClampedArray,
          readonly width: number,
          readonly height: number
        ) {}
      },
      createCanvas: () => ({
        getContext: () => ({ putImageData: vi.fn() }),
        encode: vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
      })
    }
  };
}
