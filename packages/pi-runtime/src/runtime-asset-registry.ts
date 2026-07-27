import { createHash } from "node:crypto";
import {
  MAX_ASSET_READ_BYTES,
  MAX_RUNTIME_ASSET_BYTES,
  MAX_RUNTIME_ASSET_ENTRIES,
  MAX_RUNTIME_DECODED_ASSET_BYTES,
  RuntimeError,
  type AssetReference
} from "@pi67/domain";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  type AssetReadResult
} from "@pi67/protocol";

interface RegisterAssetOptions {
  stableKey: string;
  mimeType: string;
  base64: string;
}

interface AssetEntry {
  id: string;
  mimeType: string;
  byteLength: number;
  base64: string;
  decoded: Buffer | undefined;
  lastAccess: number;
}

const MAX_RUNTIME_ASSET_BASE64_CHARS = Math.ceil(MAX_RUNTIME_ASSET_BYTES / 3) * 4;

/** A bounded, disposable registry for binary data already owned by the active Pi Session. */
export class RuntimeAssetRegistry {
  private readonly entries = new Map<string, AssetEntry>();
  private sessionGeneration = 0;
  private decodedBytes = 0;
  private clock = 0;

  reset(sessionGeneration: number): void {
    this.entries.clear();
    this.sessionGeneration = sessionGeneration;
    this.decodedBytes = 0;
    this.clock = 0;
  }

  register(options: RegisterAssetOptions): AssetReference | undefined {
    if (!isAllowedMimeType(options.mimeType)) return undefined;
    const byteLength = decodedBase64Length(options.base64);
    if (byteLength === undefined || byteLength < 1 || byteLength > MAX_RUNTIME_ASSET_BYTES) return undefined;
    const id = assetId(this.sessionGeneration, options.stableKey, options.mimeType, byteLength);
    const existing = this.entries.get(id);
    if (existing) {
      existing.lastAccess = ++this.clock;
      return reference(existing, this.sessionGeneration);
    }

    while (this.entries.size >= MAX_RUNTIME_ASSET_ENTRIES) this.evictOldestEntry();
    const entry: AssetEntry = {
      id,
      mimeType: options.mimeType,
      byteLength,
      base64: options.base64,
      decoded: undefined,
      lastAccess: ++this.clock
    };
    this.entries.set(id, entry);
    return reference(entry, this.sessionGeneration);
  }

  read(options: {
    assetId: string;
    sessionGeneration: number;
    offset: number;
    length?: number;
  }): AssetReadResult {
    if (options.sessionGeneration !== this.sessionGeneration) {
      throw new RuntimeError("INVALID_PAYLOAD", "The asset belongs to a stale session generation.", {
        details: {
          expectedSessionGeneration: this.sessionGeneration,
          receivedSessionGeneration: options.sessionGeneration
        }
      });
    }
    const entry = this.entries.get(options.assetId);
    if (!entry) {
      throw new RuntimeError("INVALID_PAYLOAD", "The requested session asset is unavailable.");
    }
    const length = options.length ?? MAX_ASSET_READ_BYTES;
    if (
      !Number.isSafeInteger(options.offset)
      || options.offset < 0
      || options.offset >= entry.byteLength
      || !Number.isSafeInteger(length)
      || length < 1
      || length > MAX_ASSET_READ_BYTES
    ) {
      throw new RuntimeError("INVALID_PAYLOAD", "The requested asset byte range is invalid.");
    }

    const decoded = this.decode(entry);
    entry.lastAccess = ++this.clock;
    const end = Math.min(entry.byteLength, options.offset + length);
    const data = Uint8Array.from(decoded.subarray(options.offset, end)).buffer;
    return {
      assetId: entry.id,
      mimeType: entry.mimeType,
      byteLength: entry.byteLength,
      offset: options.offset,
      data,
      done: end === entry.byteLength
    };
  }

  private decode(entry: AssetEntry): Buffer {
    if (entry.decoded) return entry.decoded;
    this.evictDecodedFor(entry.byteLength, entry.id);
    const decoded = Buffer.from(entry.base64, "base64");
    if (decoded.byteLength !== entry.byteLength) {
      throw new RuntimeError("INVALID_PAYLOAD", "The requested session asset is malformed.");
    }
    entry.decoded = decoded;
    this.decodedBytes += decoded.byteLength;
    return decoded;
  }

  private evictDecodedFor(requiredBytes: number, protectedId: string): void {
    const candidates = [...this.entries.values()]
      .filter((entry) => entry.id !== protectedId && entry.decoded !== undefined)
      .sort((left, right) => left.lastAccess - right.lastAccess);
    while (this.decodedBytes + requiredBytes > MAX_RUNTIME_DECODED_ASSET_BYTES) {
      const candidate = candidates.shift();
      if (!candidate?.decoded) break;
      this.decodedBytes -= candidate.decoded.byteLength;
      candidate.decoded = undefined;
    }
  }

  private evictOldestEntry(): void {
    let oldest: AssetEntry | undefined;
    for (const entry of this.entries.values()) {
      if (!oldest || entry.lastAccess < oldest.lastAccess) oldest = entry;
    }
    if (!oldest) return;
    if (oldest.decoded) this.decodedBytes -= oldest.decoded.byteLength;
    this.entries.delete(oldest.id);
  }
}

function decodedBase64Length(value: string): number | undefined {
  if (
    value.length === 0
    || value.length > MAX_RUNTIME_ASSET_BASE64_CHARS
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  ) return undefined;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function assetId(generation: number, stableKey: string, mimeType: string, byteLength: number): string {
  const digest = createHash("sha256")
    .update(String(generation))
    .update("\0")
    .update(stableKey)
    .update("\0")
    .update(mimeType)
    .update("\0")
    .update(String(byteLength))
    .digest("hex")
    .slice(0, 32);
  return `asset-${digest}`;
}

function reference(entry: AssetEntry, sessionGeneration: number): AssetReference {
  return { id: entry.id, byteLength: entry.byteLength, sessionGeneration };
}

function isAllowedMimeType(value: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.some((mimeType) => mimeType === value);
}
