import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_ASSET_READ_BYTES, type AssetReference } from "@pi67/domain";
import { ConversationAssetController } from "./conversation-asset-controller.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("ConversationAssetController", () => {
  it("loads transferred chunks once, caches the Blob URL and revokes it after retention", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const source = new Uint8Array(MAX_ASSET_READ_BYTES + 3);
    source.set([9, 8, 7, 6]);
    source.set([1, 2, 3], MAX_ASSET_READ_BYTES);
    const requests: Array<{ offset: number; length: number }> = [];
    const blobs: Blob[] = [];
    const revoked: string[] = [];
    const controller = new ConversationAssetController({
      request: async (asset, offset, length) => {
        requests.push({ offset, length });
        const data = source.slice(offset, offset + length).buffer;
        return {
          assetId: asset.id,
          mimeType: "image/png",
          byteLength: source.byteLength,
          offset,
          data,
          done: offset + data.byteLength === source.byteLength
        };
      },
      createObjectUrl: (blob) => {
        blobs.push(blob);
        return "blob:asset-1";
      },
      revokeObjectUrl: (url) => revoked.push(url),
      retainMs: 25
    });
    const reference = assetReference("asset-1", source.byteLength);

    const first = controller.acquire(reference);
    const second = controller.acquire(reference);
    await expect(first.value).resolves.toEqual({ objectUrl: "blob:asset-1", mimeType: "image/png" });
    await expect(second.value).resolves.toEqual({ objectUrl: "blob:asset-1", mimeType: "image/png" });
    expect(requests).toEqual([
      { offset: 0, length: MAX_ASSET_READ_BYTES },
      { offset: MAX_ASSET_READ_BYTES, length: 3 }
    ]);
    expect(new Uint8Array(await blobs[0]!.arrayBuffer())).toEqual(source);

    first.release();
    second.release();
    expect(revoked).toEqual([]);
    await vi.advanceTimersByTimeAsync(25);
    expect(revoked).toEqual(["blob:asset-1"]);
  }, 15_000);

  it("cancels an invisible in-flight load before requesting another chunk", async () => {
    let resolveFirst!: (value: {
      assetId: string;
      mimeType: string;
      byteLength: number;
      offset: number;
      data: ArrayBuffer;
      done: boolean;
    }) => void;
    const request = vi.fn(() => new Promise<{
      assetId: string;
      mimeType: string;
      byteLength: number;
      offset: number;
      data: ArrayBuffer;
      done: boolean;
    }>((resolve) => { resolveFirst = resolve; }));
    const createObjectUrl = vi.fn(() => "blob:should-not-exist");
    const controller = new ConversationAssetController({ request, createObjectUrl });
    const reference = assetReference("asset-cancel", MAX_ASSET_READ_BYTES + 1);
    const lease = controller.acquire(reference);
    lease.release();
    resolveFirst({
      assetId: reference.id,
      mimeType: "image/png",
      byteLength: reference.byteLength,
      offset: 0,
      data: new ArrayBuffer(MAX_ASSET_READ_BYTES),
      done: false
    });

    await expect(lease.value).rejects.toThrow(/cancelled/u);
    expect(request).toHaveBeenCalledOnce();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("revokes active URLs when the Agent Host generation is replaced", async () => {
    const revoked: string[] = [];
    const controller = new ConversationAssetController({
      request: async (asset) => ({
        assetId: asset.id,
        mimeType: "image/jpeg",
        byteLength: asset.byteLength,
        offset: 0,
        data: Uint8Array.from([1, 2, 3]).buffer,
        done: true
      }),
      createObjectUrl: () => "blob:old-host",
      revokeObjectUrl: (url) => revoked.push(url)
    });
    controller.replaceConnection("host-1", 1);
    const lease = controller.acquire(assetReference("asset-old", 3));
    await lease.value;

    controller.replaceConnection("host-2", 2);
    expect(revoked).toEqual(["blob:old-host"]);
    lease.release();
  });

  it("fails before transport when the bounded Renderer cache cannot reserve the asset", async () => {
    const request = vi.fn();
    const controller = new ConversationAssetController({ request, maxBytes: 4 });
    const lease = controller.acquire(assetReference("asset-large", 5));

    await expect(lease.value).rejects.toThrow(/cache limit/u);
    expect(request).not.toHaveBeenCalled();
  });
});

function assetReference(id: string, byteLength: number): AssetReference {
  return { id, byteLength, sessionGeneration: 3 };
}
