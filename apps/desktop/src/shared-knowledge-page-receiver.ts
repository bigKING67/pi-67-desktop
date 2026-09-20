import { createHash } from "node:crypto";
import { decodeKnowledgeSyncPage, KnowledgeSyncValidationError, type KnowledgeSyncExpectation } from "@pi67/protocol";
import type { SharedKnowledgeReceiptStore } from "./shared-knowledge-receipt-store.js";

/** Unconnected Main-side boundary. The future broker must supply its own trusted
 * account/service/scope expectation and matching store, never Host-owned routing.
 * Valid receipt data is not an authorization lease or a searchable projection. */
export async function receiveSharedKnowledgePage(store: SharedKnowledgeReceiptStore, bytes: Uint8Array, expected: KnowledgeSyncExpectation) {
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error("Shared knowledge page exceeds receipt limit.");
  const snapshot = bytes.slice();
  const expectation = { ...expected };
  const page = decodeKnowledgeSyncPage(snapshot, expectation, (text) => createHash("sha256").update(text, "utf8").digest("hex"));
  // Heartbeats are response metadata, never durable progress or permission.
  if (page.epoch === null || page.nextCursor === expectation.cursor) {
    const current = await store.read();
    if ((current?.cursor ?? "0") !== expectation.cursor || (current && current.epoch !== page.epoch)) {
      throw new KnowledgeSyncValidationError("sync.receiptProgress");
    }
    return { page, receipt: current };
  }
  const receipt = await store.append({ epoch: page.epoch, fromCursor: expectation.cursor,
    toCursor: page.nextCursor, bytes: snapshot });
  return { page, receipt };
}
