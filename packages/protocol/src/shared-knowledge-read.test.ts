import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeKnowledgeCanonicalContent } from "./knowledge-sync-page.js";
import { isSharedKnowledgeReceiptRequest as request, isSharedKnowledgeReceiptResult as result } from "./shared-knowledge-receipt-broker.js";
const id = "00000000-0000-4000-8000-000000000001", snapshot = { epoch: id, cursor: "1" };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const canonicalContent = JSON.stringify(["newmoney.knowledge.v1", "sop", "title", "summary", "body"]), contentRevision = hash(canonicalContent);
const read = { type: "shared-knowledge-index-read", requestId: "read", handleId: id, snapshot, assetId: id, contentRevision };
const response = { type: "shared-knowledge-index-read-result", requestId: "read", ok: true, snapshot, assetId: id, contentRevision, canonicalContent };
it("allows current-index exact-version revalidation, never a caller-selected snapshot or replacement revision", () => {
  const current = { type: "shared-knowledge-index-read-current", requestId: "read", handleId: id, assetId: id, contentRevision };
  expect(request(current)).toBe(true); expect(request({ ...current, snapshot })).toBe(false);
  expect(request({ ...current, contentRevision: "latest" })).toBe(false);
  expect(result({ ...response, type: "shared-knowledge-index-read-current-result" })).toBe(true);
  expect(result({ ...response, type: "shared-knowledge-index-read-current-result", snapshot: { ...snapshot, cursor: "0" } })).toBe(false);
  expect(result({ ...response, type: "shared-knowledge-index-read-current-result", canonicalContent: "\ud800" })).toBe(false);
});
it("accepts an exact snapshot/version read and bounded canonical bytes, not paths or grants", () => {
  expect(request(read)).toBe(true); expect(result(response)).toBe(true);
  for (const field of ["path", "model", "grant", "scope", "userId", "directory"]) {
    expect(request({ ...read, [field]: "forged" })).toBe(false); expect(result({ ...response, [field]: "forged" })).toBe(false);
  }
  expect(result({ type: response.type, requestId: "read", ok: false, errorCode: "QUERY_FAILED" })).toBe(true);
});
it.each([{ epoch: id, cursor: "0" }, { epoch: id, cursor: "9223372036854775808" }, { epoch: null, cursor: "1" }])("rejects invalid snapshot %#", snapshot => {
  expect(request({ ...read, snapshot })).toBe(false); expect(result({ ...response, snapshot })).toBe(false);
});
it.each(["", "x".repeat(1024 * 1024 + 1), "中".repeat(400_000), "\ud800"])("rejects invalid body frame %#", canonicalContent => { expect(result({ ...response, canonicalContent })).toBe(false); });
it("uses the sync canonical parser to verify the exact hash and decode untrusted document fields", () => {
  expect(decodeKnowledgeCanonicalContent(canonicalContent, contentRevision, hash)).toEqual({ kind: "sop", title: "title", summary: "summary", body: "body" });
  expect(() => decodeKnowledgeCanonicalContent(canonicalContent, "a".repeat(64), hash)).toThrow();
});
it.each([
  ["newmoney.knowledge.v1", "other", "title", "summary", "body"],
  ["newmoney.knowledge.v1", "sop", "title", "summary"],
  ["newmoney.knowledge.v1", "sop", "title", "summary", "\0"],
  ["newmoney.knowledge.v1", "sop", "title", "summary", "\ud800"],
  ["newmoney.knowledge.v1", "sop", "title", "summary", "x".repeat(100_001)]
].map(tuple => ({ tuple })))("rejects malformed canonical content even with matching hash %#", ({ tuple }) => {
  const body = JSON.stringify(tuple); expect(() => decodeKnowledgeCanonicalContent(body, hash(body), hash)).toThrow();
});
