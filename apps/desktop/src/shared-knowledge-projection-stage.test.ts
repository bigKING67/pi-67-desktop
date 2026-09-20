import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SharedKnowledgeReceiptStore } from "./shared-knowledge-receipt-store.js";
import { materializeSharedKnowledgeProjection, stageSharedKnowledgeProjection } from "./shared-knowledge-projection-stage.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const id = "00000000-0000-4000-8000-000000000001";
const epoch = "00000000-0000-4000-8000-000000000002";
const scope = { teamId: id, scopeKind: "team" as const, scopeId: id };
const limits = { maxPages: 10, maxAssets: 10 };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-projection-test-")); roots.push(root);
  return new SharedKnowledgeReceiptStore(root, "a".repeat(64));
}
function page(position: number, operation = "upsert", body = "正文") {
  const canonicalContent = JSON.stringify(["newmoney.knowledge.v1", "sop", "标题", "摘要", body]);
  return { ...scope, epoch, nextCursor: String(position), headCursor: String(position), hasMore: false,
    issuedAt: "2026-09-01T00:00:00Z", leaseExpiresAt: "2026-09-01T00:05:00Z", permissionRevision: hash(String(position)),
    changes: [{ cursor: String(position), assetId: id, contentRevision: hash(canonicalContent), operation,
      ...(operation === "upsert" ? { canonicalContent } : {}) }] };
}
async function append(store: SharedKnowledgeReceiptStore, position: number, value = page(position)) {
  return store.append({ epoch, fromCursor: String(position - 1), toCursor: String(position),
    bytes: new TextEncoder().encode(JSON.stringify(value)) });
}

it("rebuilds the latest version across historical permission revisions without retaining bodies or granting access", async () => {
  const store = await fixture();
  await append(store, 1);
  const second = page(2, "upsert", "更新正文");
  const pointer = await append(store, 2, second);
  const result = await stageSharedKnowledgeProjection(store, scope, limits);
  expect(result).toMatchObject({ epoch, cursor: "2", capturedHeadCursor: "2", pages: 2, receiptRecord: pointer.record });
  expect(result.versions).toEqual([{ assetId: id, cursor: "2", operation: "upsert", contentRevision: second.changes[0]!.contentRevision }]);
  expect(JSON.stringify(result)).not.toContain("正文");
  expect(result).not.toHaveProperty("leaseExpiresAt");
  expect(result).not.toHaveProperty("searchable");
  expect(Object.isFrozen(result.versions[0])).toBe(true);
});

it("retains a revoke instead of falling back to an older active version", async () => {
  const store = await fixture(); await append(store, 1); await append(store, 2, page(2, "revoke"));
  expect((await stageSharedKnowledgeProjection(store, scope, limits)).versions).toMatchObject([{ operation: "revoke", cursor: "2" }]);
  await append(store, 3, page(3, "upsert", "重新发布"));
  expect((await stageSharedKnowledgeProjection(store, scope, limits)).versions).toMatchObject([{ operation: "upsert", cursor: "3" }]);
});

it.each(["scope", "content", "cursor", "epoch", "head"])("rejects persisted but semantically invalid %s data without returning a partial manifest", async (failure) => {
  const store = await fixture();
  const first = page(1); first.headCursor = "3"; first.hasMore = true; await append(store, 1, first);
  const second = page(2);
  if (failure === "scope") second.scopeId = epoch;
  if (failure === "content") second.changes[0]!.canonicalContent = "tampered";
  if (failure === "cursor") second.nextCursor = "3";
  if (failure === "epoch") second.epoch = id;
  if (failure !== "head") { second.headCursor = "3"; second.hasMore = true; }
  await append(store, 2, second);
  await expect(stageSharedKnowledgeProjection(store, scope, limits)).rejects.toThrow();
  expect((await store.read())?.cursor).toBe("2");
});

it("fails closed on budgets or cancellation and does not change receipts", async () => {
  const store = await fixture(); await append(store, 1);
  const second = page(2); second.changes[0]!.assetId = epoch; await append(store, 2, second);
  await expect(stageSharedKnowledgeProjection(store, scope, { ...limits, maxAssets: 1 })).rejects.toThrow("budget");
  await expect(stageSharedKnowledgeProjection(store, scope, { ...limits, maxPages: 1 })).rejects.toThrow("budget");
  await expect(stageSharedKnowledgeProjection(store, scope, limits, AbortSignal.abort())).rejects.toThrow();
  expect((await store.read())?.cursor).toBe("2");
});

it("distinguishes an empty snapshot and an incomplete captured head from search readiness", async () => {
  const store = await fixture();
  expect(await stageSharedKnowledgeProjection(store, scope, limits)).toMatchObject({ epoch: null, cursor: "0", versions: [], receiptRecord: null });
  const first = page(1); first.headCursor = "9"; first.hasMore = true; await append(store, 1, first);
  expect(await stageSharedKnowledgeProjection(store, scope, limits)).toMatchObject({ cursor: "1", capturedHeadCursor: "9" });
});

it("materializes only the latest active body and never forwards superseded or revoked content", async () => {
  const store = await fixture();
  await append(store, 1, page(1, "upsert", "旧正文"));
  await append(store, 2, page(2, "upsert", "最新正文"));
  const other = page(3, "upsert", "撤销正文"); other.changes[0]!.assetId = epoch; await append(store, 3, other);
  const revoked = page(4, "revoke"); revoked.changes[0]!.assetId = epoch; await append(store, 4, revoked);
  const bodies: string[] = [];
  const result = await materializeSharedKnowledgeProjection(store, scope, limits, async (version, body) => {
    expect(version.cursor).toBe("2"); bodies.push(body);
  });
  expect(bodies).toEqual([page(2, "upsert", "最新正文").changes[0]!.canonicalContent]);
  expect(result.versions).toHaveLength(2);
  expect(result.cursor).toBe("4");
});

it("rejects an append during materialization instead of certifying stale staging", async () => {
  const store = await fixture(); await append(store, 1);
  await expect(materializeSharedKnowledgeProjection(store, scope, limits, async () => {
    await append(store, 2, page(2, "revoke"));
  })).rejects.toThrow("snapshot changed");
  const bodies: string[] = [];
  await materializeSharedKnowledgeProjection(store, scope, limits, async (_version, body) => { bodies.push(body); });
  expect(bodies).toEqual([]);
});

it("propagates sink failure and mid-sink cancellation without a success manifest", async () => {
  const store = await fixture(); await append(store, 1);
  await expect(materializeSharedKnowledgeProjection(store, scope, limits, async () => {
    throw new Error("synthetic staging failure");
  })).rejects.toThrow("synthetic staging failure");
  const controller = new AbortController();
  await expect(materializeSharedKnowledgeProjection(store, scope, limits, async (_version, _body, signal) => {
    expect(signal).toBe(controller.signal); controller.abort();
  }, controller.signal)).rejects.toThrow();
  expect((await store.read())?.cursor).toBe("1");
});

it("validates the whole manifest before sending any content to staging", async () => {
  const store = await fixture(); await append(store, 1);
  const invalid = page(2); invalid.changes[0]!.canonicalContent = "corrupt"; await append(store, 2, invalid);
  const bodies: string[] = [];
  await expect(materializeSharedKnowledgeProjection(store, scope, limits, async (_version, body) => {
    bodies.push(body);
  })).rejects.toThrow();
  expect(bodies).toEqual([]);
});
