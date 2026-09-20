import { invalidResponse } from "./enterprise-context-gateway-validation.js";
import { decodeKnowledgeSyncPage, type KnowledgeSyncExpectation, type KnowledgeSyncPage } from "./enterprise-knowledge-sync-page.js";

const MAX_BYTES = 2 * 1024 * 1024;

export interface KnowledgeSyncResponse {
  readonly page: KnowledgeSyncPage;
  /** Owned exact response bytes, validated before delivery; never reserialize page for receipts. */
  readonly bytes: Uint8Array;
}

/** Bound decoded response bytes while reading, independent of Content-Length.
 * Cancellation discards all buffered data; no caller ever receives a partial page. */
export async function readKnowledgeSyncResponse(response: Response, expected: KnowledgeSyncExpectation, signal: AbortSignal): Promise<KnowledgeSyncResponse> {
  const expectation = { ...expected };
  if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" || response.body === null) {
    void response.body?.cancel().catch(() => undefined);
    throw invalidResponse("sync.response");
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const bytes = new Uint8Array(MAX_BYTES);
  let size = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const result = await reader.read();
      signal.throwIfAborted();
      if (result.done) break;
      if (result.value.byteLength > MAX_BYTES - size) throw invalidResponse("sync.bytes");
      // Own the bytes even if a synthetic/custom stream reuses its chunk buffer.
      bytes.set(result.value, size);
      size += result.value.byteLength;
    }
    const received = bytes.slice(0, size);
    const page = decodeKnowledgeSyncPage(received, expectation);
    signal.throwIfAborted();
    return { page, bytes: received };
  } catch (error) {
    abort();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
