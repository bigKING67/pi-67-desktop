export interface AssetReference {
  id: string;
  byteLength: number;
  sessionGeneration: number;
}

export const MAX_ASSET_ID_CHARS = 128;
export const MAX_RUNTIME_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_ASSET_READ_BYTES = 1024 * 1024;
export const MAX_RUNTIME_ASSET_ENTRIES = 512;
export const MAX_RUNTIME_DECODED_ASSET_BYTES = 64 * 1024 * 1024;
