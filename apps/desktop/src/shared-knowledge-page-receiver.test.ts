import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KnowledgeSyncExpectation } from "@pi67/protocol";
import { afterEach, expect, it } from "vitest";
import { receiveSharedKnowledgePage } from "./shared-knowledge-page-receiver.js";
import { SharedKnowledgeReceiptStore } from "./shared-knowledge-receipt-store.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const id = "00000000-0000-0000-0000-000000000001";
const epoch = "00000000-0000-0000-0000-000000000002";
const expected: KnowledgeSyncExpectation = { teamId: id, scopeKind: "team", scopeId: id,
  epoch: null, cursor: "0", permissionRevision: "a".repeat(64), limit: 50 };
const content = JSON.stringify(["newmoney.knowledge.v1", "sop", "标题", "摘要", "正文"]);
function page() {
  return { teamId: id, scopeKind: "team", scopeId: id, epoch, nextCursor: "1", headCursor: "1", hasMore: false,
    issuedAt: "2026-09-12T00:00:00Z", leaseExpiresAt: "2026-09-12T00:05:00Z", permissionRevision: expected.permissionRevision,
    changes: [{ cursor: "1", assetId: id, contentRevision: createHash("sha256").update(content).digest("hex"), operation: "upsert", canonicalContent: content }] };
}
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-page-receiver-test-")); roots.push(root);
  return new SharedKnowledgeReceiptStore(root, "a".repeat(64));
}

it("persists exactly the validated bytes and snapshots caller input before awaiting storage", async () => {
  const store = await fixture();
  const bytes = encode(page()), original = bytes.slice(), expectation = { ...expected };
  const pending = receiveSharedKnowledgePage(store, bytes, expectation);
  bytes.fill(0); expectation.cursor = "9";
  const result = await pending;
  expect(result.receipt?.cursor).toBe("1");
  expect(result.page).not.toHaveProperty("assertValid");
  await store.replayHistory(1, async (receipt) => { expect(new Uint8Array(receipt.bytes)).toEqual(original); });
  expect((await receiveSharedKnowledgePage(store, original, expected)).receipt).toEqual(result.receipt);
});

it.each(["scope", "permission", "hash", "gap", "bytes"])("rejects invalid %s without creating receipt progress", async (failure) => {
  const store = await fixture();
  const value = page();
  if (failure === "scope") value.scopeId = epoch;
  if (failure === "permission") value.permissionRevision = "b".repeat(64);
  if (failure === "hash") value.changes[0]!.canonicalContent += "x";
  if (failure === "gap") value.changes[0]!.cursor = "2";
  const bytes = failure === "bytes" ? new Uint8Array(2 * 1024 * 1024 + 1) : encode(value);
  await expect(receiveSharedKnowledgePage(store, bytes, expected)).rejects.toThrow();
  expect(await store.read()).toBeUndefined();
});

it("does not persist an empty heartbeat or treat it as a grant", async () => {
  const store = await fixture();
  const result = await receiveSharedKnowledgePage(store, encode({ ...page(), epoch: null,
    nextCursor: "0", headCursor: "0", changes: [] }), expected);
  expect(result.receipt).toBeUndefined();
  expect(await store.read()).toBeUndefined();
  expect(result.page).not.toHaveProperty("assertValid");
});

it("propagates storage cursor conflicts instead of reporting a received page", async () => {
  const store = await fixture();
  const first = await receiveSharedKnowledgePage(store, encode(page()), expected);
  const value = page(); value.headCursor = "2"; value.hasMore = true;
  await expect(receiveSharedKnowledgePage(store, encode(value), expected)).rejects.toThrow("retry conflicts");
  expect(await store.read()).toEqual(first.receipt);
});

it("rejects an ahead-of-disk heartbeat even when its wire cursors agree", async () => {
  const store = await fixture();
  const heartbeat = encode({ ...page(), changes: [], nextCursor: "9", headCursor: "9" });
  await expect(receiveSharedKnowledgePage(store, heartbeat, { ...expected, epoch, cursor: "9" })).rejects.toThrow("sync.receiptProgress");
  expect(await store.read()).toBeUndefined();
});

it("rejects heartbeat rewind and epoch replacement without altering saved progress", async () => {
  const store = await fixture();
  const saved = await receiveSharedKnowledgePage(store, encode(page()), expected);
  await expect(receiveSharedKnowledgePage(store, encode({ ...page(), epoch: null, changes: [],
    nextCursor: "0", headCursor: "0" }), expected)).rejects.toThrow("sync.receiptProgress");
  await expect(receiveSharedKnowledgePage(store, encode({ ...page(), epoch: id, changes: [] }),
    { ...expected, epoch: id, cursor: "1" })).rejects.toThrow("sync.receiptProgress");
  expect(await store.read()).toEqual(saved.receipt);
});

it("returns the verified existing receipt for a matching heartbeat without appending a page", async () => {
  const store = await fixture();
  const saved = await receiveSharedKnowledgePage(store, encode(page()), expected);
  const heartbeat = await receiveSharedKnowledgePage(store, encode({ ...page(), changes: [] }),
    { ...expected, epoch, cursor: "1" });
  expect(heartbeat.receipt).toEqual(saved.receipt);
  expect((await store.verifyHistory(1)).pages).toBe(1);
});
