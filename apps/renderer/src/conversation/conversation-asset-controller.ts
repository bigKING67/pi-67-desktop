import {
  MAX_ASSET_READ_BYTES,
  type AssetReference
} from "@pi67/domain";
import { ALLOWED_IMAGE_MIME_TYPES, type AssetReadResult } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";

const DEFAULT_CACHE_ENTRIES = 64;
const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024;
const DEFAULT_RETAIN_MS = 10_000;

export interface ConversationAssetValue {
  objectUrl: string;
  mimeType: string;
}

export interface ConversationAssetLease {
  value: Promise<ConversationAssetValue>;
  release: () => void;
}

interface ConversationAssetControllerOptions {
  request: (asset: AssetReference, offset: number, length: number) => Promise<AssetReadResult>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
  maxEntries?: number;
  maxBytes?: number;
  retainMs?: number;
}

interface AssetCacheEntry {
  key: string;
  reference: AssetReference;
  refs: number;
  lastAccess: number;
  lifecycle: number;
  value: Promise<ConversationAssetValue>;
  objectUrl: string | undefined;
  retainTimer: ReturnType<typeof setTimeout> | undefined;
}

/** Owns transferred image bytes and Blob URLs outside React and Zustand. */
export class ConversationAssetController {
  private readonly entries = new Map<string, AssetCacheEntry>();
  private readonly request: ConversationAssetControllerOptions["request"];
  private readonly createObjectUrl: (blob: Blob) => string;
  private readonly revokeObjectUrl: (url: string) => void;
  private readonly schedule: NonNullable<ConversationAssetControllerOptions["schedule"]>;
  private readonly cancelSchedule: NonNullable<ConversationAssetControllerOptions["cancelSchedule"]>;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly retainMs: number;
  private lifecycle = 0;
  private clock = 0;
  private reservedBytes = 0;
  private connectionKey: string | undefined;

  constructor(options: ConversationAssetControllerOptions) {
    this.request = options.request;
    this.createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
    this.maxEntries = options.maxEntries ?? DEFAULT_CACHE_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_CACHE_BYTES;
    this.retainMs = options.retainMs ?? DEFAULT_RETAIN_MS;
  }

  replaceConnection(hostInstanceId: string, hostEpoch: number): void {
    const nextKey = `${hostInstanceId}:${hostEpoch}`;
    if (nextKey === this.connectionKey) return;
    this.connectionKey = nextKey;
    this.clear();
  }

  disconnect(): void {
    this.connectionKey = undefined;
    this.clear();
  }

  acquire(reference: AssetReference): ConversationAssetLease {
    const key = assetKey(reference);
    let entry = this.entries.get(key);
    if (!entry) {
      try {
        this.reserve(reference.byteLength);
      } catch (error) {
        return rejectedLease(error);
      }
      entry = this.createEntry(key, reference);
      this.entries.set(key, entry);
      this.reservedBytes += reference.byteLength;
    }

    entry.refs += 1;
    entry.lastAccess = ++this.clock;
    if (entry.retainTimer !== undefined) {
      this.cancelSchedule(entry.retainTimer);
      entry.retainTimer = undefined;
    }

    let released = false;
    return {
      value: entry.value,
      release: () => {
        if (released) return;
        released = true;
        this.releaseEntry(entry!);
      }
    };
  }

  clear(): void {
    this.lifecycle += 1;
    for (const entry of this.entries.values()) this.removeEntry(entry);
    this.entries.clear();
    this.reservedBytes = 0;
  }

  private createEntry(key: string, reference: AssetReference): AssetCacheEntry {
    const entry: AssetCacheEntry = {
      key,
      reference,
      refs: 0,
      lastAccess: ++this.clock,
      lifecycle: this.lifecycle,
      value: Promise.resolve({ objectUrl: "", mimeType: "" }),
      objectUrl: undefined,
      retainTimer: undefined
    };
    entry.value = this.load(entry).catch((error: unknown) => {
      if (this.entries.get(key) === entry) this.removeEntry(entry);
      throw error;
    });
    return entry;
  }

  private async load(entry: AssetCacheEntry): Promise<ConversationAssetValue> {
    const bytes = new Uint8Array(entry.reference.byteLength);
    let offset = 0;
    let mimeType: string | undefined;
    while (offset < entry.reference.byteLength) {
      const length = Math.min(MAX_ASSET_READ_BYTES, entry.reference.byteLength - offset);
      const result = await this.request(entry.reference, offset, length);
      assertAssetChunk(entry.reference, result, offset, mimeType);
      mimeType ??= result.mimeType;
      bytes.set(new Uint8Array(result.data), offset);
      offset += result.data.byteLength;
      if (entry.refs === 0) throw new Error("Asset loading was cancelled after leaving the visible transcript.");
      if (result.done !== (offset === entry.reference.byteLength)) {
        throw new Error("The Agent Host returned an inconsistent asset completion marker.");
      }
    }
    if (entry.lifecycle !== this.lifecycle || this.entries.get(entry.key) !== entry) {
      throw new Error("The asset belongs to a retired Agent Host connection.");
    }
    if (mimeType === undefined) throw new Error("The Agent Host returned an asset without a MIME type.");
    const objectUrl = this.createObjectUrl(new Blob([bytes], { type: mimeType }));
    entry.objectUrl = objectUrl;
    if (entry.refs === 0) this.scheduleRetention(entry);
    return { objectUrl, mimeType };
  }

  private reserve(byteLength: number): void {
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > this.maxBytes) {
      throw new Error("The image exceeds the Renderer asset cache limit.");
    }
    while (
      this.entries.size >= this.maxEntries
      || this.reservedBytes + byteLength > this.maxBytes
    ) {
      const evictable = [...this.entries.values()]
        .filter((entry) => entry.refs === 0)
        .sort((left, right) => left.lastAccess - right.lastAccess)[0];
      if (!evictable) throw new Error("Visible images have filled the Renderer asset cache.");
      this.removeEntry(evictable);
    }
  }

  private releaseEntry(entry: AssetCacheEntry): void {
    if (this.entries.get(entry.key) !== entry || entry.refs === 0) return;
    entry.refs -= 1;
    entry.lastAccess = ++this.clock;
    if (entry.refs === 0 && entry.objectUrl !== undefined) this.scheduleRetention(entry);
  }

  private scheduleRetention(entry: AssetCacheEntry): void {
    if (entry.retainTimer !== undefined || this.entries.get(entry.key) !== entry) return;
    entry.retainTimer = this.schedule(() => {
      entry.retainTimer = undefined;
      if (entry.refs === 0) this.removeEntry(entry);
    }, this.retainMs);
  }

  private removeEntry(entry: AssetCacheEntry): void {
    if (entry.retainTimer !== undefined) this.cancelSchedule(entry.retainTimer);
    entry.retainTimer = undefined;
    if (entry.objectUrl !== undefined) this.revokeObjectUrl(entry.objectUrl);
    entry.objectUrl = undefined;
    if (this.entries.delete(entry.key)) this.reservedBytes -= entry.reference.byteLength;
  }
}

function assertAssetChunk(
  reference: AssetReference,
  result: AssetReadResult,
  expectedOffset: number,
  expectedMimeType: string | undefined
): void {
  if (
    result.assetId !== reference.id
    || result.byteLength !== reference.byteLength
    || result.offset !== expectedOffset
    || !ALLOWED_IMAGE_MIME_TYPES.some((mimeType) => mimeType === result.mimeType)
    || !(result.data instanceof ArrayBuffer)
    || result.data.byteLength < 1
    || result.data.byteLength > MAX_ASSET_READ_BYTES
    || (expectedMimeType !== undefined && result.mimeType !== expectedMimeType)
  ) {
    throw new Error("The Agent Host returned an invalid asset chunk.");
  }
}

function assetKey(reference: AssetReference): string {
  return `${reference.sessionGeneration}:${reference.id}:${reference.byteLength}`;
}

function rejectedLease(error: unknown): ConversationAssetLease {
  return {
    value: Promise.reject(error),
    release: () => undefined
  };
}

export const conversationAssetController = new ConversationAssetController({
  request: (asset, offset, length) => agentConnectionController.request("asset.read", {
    assetId: asset.id,
    sessionGeneration: asset.sessionGeneration,
    offset,
    length
  })
});

const unsubscribeConnection = agentConnectionController.subscribe({
  onConnected: (identity) => {
    conversationAssetController.replaceConnection(identity.hostInstanceId, identity.hostEpoch);
  },
  onTeardown: () => {
    conversationAssetController.disconnect();
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribeConnection();
    conversationAssetController.disconnect();
  });
}
