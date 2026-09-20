import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeKnowledgeSyncPage, type KnowledgeSyncExpectation } from "./enterprise-knowledge-sync-page.js";

const id = "00000000-0000-0000-0000-000000000001";
const epoch = "00000000-0000-0000-0000-000000000002";
const expected: KnowledgeSyncExpectation = { teamId: id, scopeKind: "team", scopeId: id, epoch: null, cursor: "0", permissionRevision: "a".repeat(64), limit: 50 };
const content = JSON.stringify(["newmoney.knowledge.v1", "sop", "标题", "摘要", "正文\n保留"]);
function page() {
  return { teamId: id, scopeKind: "team", scopeId: id, epoch, nextCursor: "1", headCursor: "1", hasMore: false,
    issuedAt: "2026-09-11T00:00:00Z", leaseExpiresAt: "2026-09-11T00:05:00Z", permissionRevision: expected.permissionRevision,
    changes: [{ cursor: "1", assetId: id, contentRevision: createHash("sha256").update(content).digest("hex"), operation: "upsert", canonicalContent: content }] };
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
it("validates exact canonical content while retaining receipt-only metadata", () => {
  const result = decodeKnowledgeSyncPage(bytes(page()), expected);
  expect(result.changes[0]?.canonicalContent).toBe(content);
  expect(result.nextCursor).toBe("1");
  expect(result).not.toHaveProperty("assertValid");
});
it.each(["teamId", "scopeId", "scopeKind", "permissionRevision", "epoch", "nextCursor", "hasMore"])("rejects mismatched %s", (field) => {
  const value = { ...page(), [field]: field === "hasMore" ? true : "wrong" };
  expect(() => decodeKnowledgeSyncPage(bytes(value), expected)).toThrow();
});
it("requires contiguous events, strict tombstones and verified content hashes", () => {
  const value = page();
  value.changes[0]!.cursor = "2";
  expect(() => decodeKnowledgeSyncPage(bytes(value), expected)).toThrow();
  const corrupt = page(); corrupt.changes[0]!.canonicalContent += " ";
  expect(() => decodeKnowledgeSyncPage(bytes(corrupt), expected)).toThrow();
  const tombstone = { ...page(), changes: [{ cursor: "1", assetId: id, operation: "revoke", contentRevision: "b".repeat(64) }] };
  expect(decodeKnowledgeSyncPage(bytes(tombstone), expected).changes[0]?.operation).toBe("revoke");
  expect(() => decodeKnowledgeSyncPage(bytes({ ...tombstone, changes: [{ ...tombstone.changes[0], canonicalContent: content }] }), expected)).toThrow();
});
it("keeps bigint cursors lossless and rejects missing progress", () => {
  const value = { ...page(), nextCursor: "9007199254740994", headCursor: "9007199254740994",
    changes: [{ ...page().changes[0], cursor: "9007199254740994" }] };
  const result = decodeKnowledgeSyncPage(bytes(value), { ...expected, epoch, cursor: "9007199254740993" });
  expect(result.nextCursor).toBe("9007199254740994");
  expect(() => decodeKnowledgeSyncPage(bytes({ ...page(), changes: [], nextCursor: "0", hasMore: true }), expected)).toThrow();
});
it("bounds UTF-8 bytes, epoch resets, lease length and result count", () => {
  expect(() => decodeKnowledgeSyncPage(new Uint8Array(2 * 1024 * 1024 + 1), expected)).toThrow();
  expect(() => decodeKnowledgeSyncPage(new Uint8Array([0xff]), expected)).toThrow();
  expect(() => decodeKnowledgeSyncPage(bytes(page()), { ...expected, epoch: id })).toThrow();
  expect(() => decodeKnowledgeSyncPage(bytes({ ...page(), leaseExpiresAt: "2026-09-11T00:05:01Z" }), expected)).toThrow();
  const empty = { ...page(), epoch: null, changes: [], nextCursor: "0", headCursor: "0" };
  expect(decodeKnowledgeSyncPage(bytes(empty), expected).epoch).toBeNull();
  expect(() => decodeKnowledgeSyncPage(bytes(page()), { ...expected, limit: 0 })).toThrow();
});
it("rejects invalid canonical fields even when their hash is self-consistent", () => {
  for (const tuple of [
    ["unknown", "sop", "Title", "Summary", "Body"],
    ["newmoney.knowledge.v1", "other", "Title", "Summary", "Body"],
    ["newmoney.knowledge.v1", "sop", "Title", "Summary", "\uD800"],
    ["newmoney.knowledge.v1", "sop", "Title", "Summary", "\0"],
    ["newmoney.knowledge.v1", "sop", "x".repeat(161), "Summary", "Body"]
  ]) {
    const value = page();
    const canonicalContent = JSON.stringify(tuple);
    value.changes[0]!.canonicalContent = canonicalContent;
    value.changes[0]!.contentRevision = createHash("sha256").update(canonicalContent).digest("hex");
    expect(() => decodeKnowledgeSyncPage(bytes(value), expected)).toThrow();
  }
});
