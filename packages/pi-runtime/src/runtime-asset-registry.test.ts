import { describe, expect, it } from "vitest";
import {
  MAX_ASSET_READ_BYTES,
  MAX_RUNTIME_ASSET_BYTES,
  MAX_RUNTIME_ASSET_ENTRIES
} from "@pi67/domain";
import { RuntimeAssetRegistry } from "./runtime-asset-registry.js";

describe("RuntimeAssetRegistry", () => {
  it("registers stable generation-bound references and returns independent chunks", () => {
    const registry = new RuntimeAssetRegistry();
    registry.reset(7);
    const bytes = Uint8Array.from({ length: MAX_ASSET_READ_BYTES + 3 }, (_, index) => index % 251);
    const source = {
      stableKey: "entry-1:image:0",
      mimeType: "image/png",
      base64: Buffer.from(bytes).toString("base64")
    };

    const firstReference = registry.register(source);
    const secondReference = registry.register(source);
    expect(firstReference).toEqual(secondReference);
    expect(firstReference).toMatchObject({ byteLength: bytes.byteLength, sessionGeneration: 7 });

    const first = registry.read({
      assetId: firstReference!.id,
      sessionGeneration: 7,
      offset: 0
    });
    const second = registry.read({
      assetId: firstReference!.id,
      sessionGeneration: 7,
      offset: first.data.byteLength
    });
    expect(first.data.byteLength).toBe(MAX_ASSET_READ_BYTES);
    expect(first.done).toBe(false);
    expect(second.data.byteLength).toBe(3);
    expect(second.done).toBe(true);
    expect(Buffer.concat([Buffer.from(first.data), Buffer.from(second.data)])).toEqual(Buffer.from(bytes));

    new Uint8Array(first.data).fill(0);
    const repeated = registry.read({ assetId: firstReference!.id, sessionGeneration: 7, offset: 0, length: 8 });
    expect(new Uint8Array(repeated.data)).toEqual(bytes.slice(0, 8));
  });

  it("rejects stale generations, invalid ranges and handles cleared by reset", () => {
    const registry = new RuntimeAssetRegistry();
    registry.reset(2);
    const reference = registry.register({
      stableKey: "entry-2:image:0",
      mimeType: "image/jpeg",
      base64: Buffer.from([1, 2, 3]).toString("base64")
    })!;

    expect(() => registry.read({ assetId: reference.id, sessionGeneration: 1, offset: 0 }))
      .toThrow(/stale session generation/u);
    expect(() => registry.read({ assetId: reference.id, sessionGeneration: 2, offset: 3 }))
      .toThrow(/byte range/u);
    expect(() => registry.read({
      assetId: reference.id,
      sessionGeneration: 2,
      offset: 0,
      length: MAX_ASSET_READ_BYTES + 1
    })).toThrow(/byte range/u);

    registry.reset(3);
    expect(() => registry.read({ assetId: reference.id, sessionGeneration: 3, offset: 0 }))
      .toThrow(/unavailable/u);
  });

  it("fails closed for malformed, unsupported and oversized image sources", () => {
    const registry = new RuntimeAssetRegistry();
    registry.reset(1);

    expect(registry.register({ stableKey: "bad", mimeType: "image/png", base64: "not base64" }))
      .toBeUndefined();
    expect(registry.register({
      stableKey: "svg",
      mimeType: "image/svg+xml",
      base64: Buffer.from("<svg/>").toString("base64")
    })).toBeUndefined();
    expect(registry.register({
      stableKey: "large",
      mimeType: "image/png",
      base64: Buffer.alloc(MAX_RUNTIME_ASSET_BYTES + 1).toString("base64")
    })).toBeUndefined();
  });

  it("keeps the handle inventory bounded by evicting the least recently used entry", () => {
    const registry = new RuntimeAssetRegistry();
    registry.reset(1);
    const references = Array.from({ length: MAX_RUNTIME_ASSET_ENTRIES + 1 }, (_, index) => registry.register({
      stableKey: `entry-${index}:image:0`,
      mimeType: "image/webp",
      base64: Buffer.from([index % 251]).toString("base64")
    })!);

    expect(() => registry.read({ assetId: references[0]!.id, sessionGeneration: 1, offset: 0 }))
      .toThrow(/unavailable/u);
    expect(new Uint8Array(registry.read({
      assetId: references.at(-1)!.id,
      sessionGeneration: 1,
      offset: 0
    }).data)[0]).toBe(MAX_RUNTIME_ASSET_ENTRIES % 251);
  });
});
