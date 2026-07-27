import type {
  FixtureAgentState,
  FixtureFailure,
  FixtureWindow
} from "./pi67-renderer-fixture-types.js";

type MockAssetReadResult =
  | {
      ok: true;
      result: {
        assetId: string;
        mimeType: string;
        byteLength: number;
        offset: number;
        data: ArrayBuffer;
        done: boolean;
      };
    }
  | { ok: false; error: FixtureFailure };

export type MockAssetReadHandler = (
  payload: Record<string, unknown>,
  current: FixtureAgentState
) => MockAssetReadResult;

export function installMockAssetReadHandler(): void {
  const testWindow = window as FixtureWindow & {
    __pi67ReadMockAsset: MockAssetReadHandler;
  };
  const decodeBase64 = (value: string): Uint8Array => {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  };
  testWindow.__pi67ReadMockAsset = (payload, current) => {
    const assetId = typeof payload.assetId === "string" ? payload.assetId : "";
    const asset = current.assets[assetId];
    if (!asset) {
      return {
        ok: false,
        error: {
          code: "INVALID_PAYLOAD",
          message: "Fixture asset is unavailable.",
          recoverable: true
        }
      };
    }
    const expectedGeneration = asset.sessionGeneration ?? current.sessionGeneration;
    if (payload.sessionGeneration !== expectedGeneration || expectedGeneration !== current.sessionGeneration) {
      return {
        ok: false,
        error: {
          code: "STALE_SESSION_GENERATION",
          message: "Fixture asset generation is stale.",
          recoverable: true
        }
      };
    }
    const offset = typeof payload.offset === "number" ? payload.offset : -1;
    const length = typeof payload.length === "number" ? payload.length : 1024 * 1024;
    const binary = decodeBase64(asset.dataBase64);
    if (
      !Number.isSafeInteger(offset)
      || offset < 0
      || offset >= binary.byteLength
      || !Number.isSafeInteger(length)
      || length < 1
    ) {
      return {
        ok: false,
        error: {
          code: "INVALID_PAYLOAD",
          message: "Fixture asset range is invalid.",
          recoverable: true
        }
      };
    }
    const data = binary.slice(offset, Math.min(binary.byteLength, offset + length)).buffer;
    return {
      ok: true,
      result: {
        assetId,
        mimeType: asset.mimeType,
        byteLength: binary.byteLength,
        offset,
        data,
        done: offset + data.byteLength === binary.byteLength
      }
    };
  };
}
