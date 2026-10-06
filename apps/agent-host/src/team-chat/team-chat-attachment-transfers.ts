import { TEAM_CHAT_ATTACHMENT_LIMITS, type TeamChatAttachment } from "@pi67/domain";
import type { TeamChatAttachmentReadResult } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";

/** Buffered upload bytes across all files at once. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** Downloaded bytes kept for chunked reads; least recently used leave first. */
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const TRANSFER_TIMEOUT_MS = 120_000;
/** Upload grants expire after five minutes; bytes held longer can no longer be stored. */
const UPLOAD_TTL_MS = 5 * 60_000;

export interface PresignedRequest {
  url: string;
  contentType?: string;
}

interface Upload {
  attachment: TeamChatAttachment;
  request: PresignedRequest;
  bytes: Uint8Array<ArrayBuffer>;
  received: number;
  startedAt: number;
}

interface Cached {
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Moves attachment bytes between renderer and object storage (ADR 0009). Bytes stay in
 * memory only: uploads until stored, downloads in a bounded cache for chunked reads.
 * Presigned URLs are used as given and never logged.
 */
export class TeamChatAttachmentTransfers {
  readonly #uploads = new Map<string, Upload>();
  readonly #cache = new Map<string, Cached>();
  /** One download per file at a time; concurrent reads share it. */
  readonly #loading = new Map<string, Promise<Cached>>();
  #cachedBytes = 0;
  /** Bumped by `clear`, so downloads that started before it are not cached. */
  #generation = 0;

  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  begin(attachment: TeamChatAttachment, request: PresignedRequest): void {
    // Uploads abandoned by a reloaded or crashed renderer expire with their grant.
    for (const [id, upload] of this.#uploads) {
      if (this.now() - upload.startedAt > UPLOAD_TTL_MS) this.#uploads.delete(id);
    }
    this.#uploads.delete(attachment.id);
    const buffered = [...this.#uploads.values()].reduce((total, upload) => total + upload.bytes.byteLength, 0);
    if (buffered + attachment.byteSize > MAX_UPLOAD_BYTES) throw invalid("Too many files are uploading at once.");
    safeUrl(request.url);
    this.#uploads.set(attachment.id, { attachment, request, bytes: new Uint8Array(attachment.byteSize), received: 0, startedAt: this.now() });
  }

  /** Chunks arrive in order; a gap or overflow is refused. */
  chunk(attachmentId: string, offset: number, data: ArrayBuffer): number {
    const upload = this.#upload(attachmentId);
    if (offset !== upload.received || offset + data.byteLength > upload.bytes.byteLength) {
      throw invalid("Attachment chunks must arrive in order and fit the declared size.");
    }
    upload.bytes.set(new Uint8Array(data), offset);
    upload.received += data.byteLength;
    return upload.received;
  }

  async finish(attachmentId: string, signal?: AbortSignal): Promise<TeamChatAttachment> {
    const upload = this.#upload(attachmentId);
    if (upload.received !== upload.bytes.byteLength) throw invalid("The attachment is incomplete.");
    try {
      const response = await this.fetchImpl(safeUrl(upload.request.url), {
        method: "PUT",
        headers: upload.request.contentType ? { "content-type": upload.request.contentType } : {},
        body: upload.bytes,
        signal: timeout(signal)
      });
      if (!response.ok) throw unavailable("The file could not be stored.");
    } finally {
      this.#uploads.delete(attachmentId);
    }
    return upload.attachment;
  }

  discard(attachmentId: string): void {
    this.#uploads.delete(attachmentId);
  }

  /** Serves a chunk, downloading the whole file on first read. */
  async read(
    attachmentId: string,
    offset: number,
    length: number,
    download: () => Promise<PresignedRequest>,
    signal?: AbortSignal
  ): Promise<TeamChatAttachmentReadResult> {
    let entry = this.#cache.get(attachmentId);
    if (entry) {
      // Refresh recency.
      this.#cache.delete(attachmentId);
      this.#cache.set(attachmentId, entry);
    } else {
      let loading = this.#loading.get(attachmentId);
      if (!loading) {
        const generation = this.#generation;
        loading = this.#download(download, signal).then((loaded) => {
          if (generation === this.#generation) this.#remember(attachmentId, loaded);
          return loaded;
        }).finally(() => this.#loading.delete(attachmentId));
        this.#loading.set(attachmentId, loading);
      }
      entry = await loading;
    }
    if (offset >= entry.bytes.byteLength) throw invalid("Read past the end of the attachment.");
    const end = Math.min(entry.bytes.byteLength, offset + Math.min(length, TEAM_CHAT_ATTACHMENT_LIMITS.chunk));
    const data = entry.bytes.slice(offset, end).buffer;
    return {
      attachmentId,
      contentType: entry.contentType.split(";")[0]!.trim(),
      byteLength: entry.bytes.byteLength,
      offset,
      data,
      done: end === entry.bytes.byteLength
    };
  }

  /** Account or team change: drop every buffered and cached byte. */
  clear(): void {
    this.#generation += 1;
    this.#uploads.clear();
    this.#cache.clear();
    this.#loading.clear();
    this.#cachedBytes = 0;
  }

  /**
   * Reads at most the attachment limit, refusing a larger declared or streamed body
   * before buffering it. The type is the service's record, not the store's header.
   */
  async #download(download: () => Promise<PresignedRequest>, signal: AbortSignal | undefined): Promise<Cached> {
    const request = await download();
    const response = await this.fetchImpl(safeUrl(request.url), { method: "GET", signal: timeout(signal) });
    if (!response.ok || !response.body) throw unavailable("The file could not be downloaded.");
    const limit = TEAM_CHAT_ATTACHMENT_LIMITS.bytes;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > limit) {
      void response.body.cancel().catch(() => undefined);
      throw unavailable("The file is not available.");
    }
    const parts: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        void reader.cancel().catch(() => undefined);
        throw unavailable("The file is not available.");
      }
      parts.push(value);
    }
    if (total < 1) throw unavailable("The file is not available.");
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.byteLength;
    }
    return { contentType: request.contentType ?? response.headers.get("content-type") ?? "application/octet-stream", bytes };
  }

  #upload(attachmentId: string): Upload {
    const upload = this.#uploads.get(attachmentId);
    if (!upload) throw invalid("No upload is in progress for this attachment.");
    return upload;
  }

  #remember(attachmentId: string, entry: Cached): void {
    const previous = this.#cache.get(attachmentId);
    if (previous) {
      this.#cache.delete(attachmentId);
      this.#cachedBytes -= previous.bytes.byteLength;
    }
    this.#cache.set(attachmentId, entry);
    this.#cachedBytes += entry.bytes.byteLength;
    for (const [key, value] of this.#cache) {
      if (this.#cachedBytes <= MAX_CACHE_BYTES || key === attachmentId) break;
      this.#cache.delete(key);
      this.#cachedBytes -= value.bytes.byteLength;
    }
  }
}

/** Storage URLs must be HTTPS (loopback HTTP only for local test stores). */
function safeUrl(raw: string): string {
  const url = new URL(raw);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw invalid("The storage address is not secure.");
  }
  return url.toString();
}

function timeout(signal: AbortSignal | undefined): AbortSignal {
  const limit = AbortSignal.timeout(TRANSFER_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, limit]) : limit;
}

/** Storage failures surface with the service's own code so the renderer shows the same copy. */
function unavailable(message: string): HostCommandError {
  return new HostCommandError("RUNTIME_NOT_READY", message, true, { serviceError: "chat_attachment_storage_unavailable" });
}

function invalid(message: string): HostCommandError {
  return new HostCommandError("INVALID_PAYLOAD", message, false);
}
