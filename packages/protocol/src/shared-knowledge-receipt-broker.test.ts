import { expect, it } from "vitest";
import { isSharedKnowledgeReceiptRequest as request, isSharedKnowledgeReceiptResult as result } from "./shared-knowledge-receipt-broker.js";

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const open = { type: "shared-knowledge-receipt-open", requestId: "open", scope: { teamId: id, scopeKind: "team", scopeId: id } };
const append = { type: "shared-knowledge-receipt-append", requestId: "append", handleId: id,
  fromCursor: "0", epoch: null, permissionRevision: "a".repeat(64), pageJson: "{}" };
const index = { type: "shared-knowledge-index-prepare", requestId: "prepare", handleId: id, models: {
  embedding: { endpoint: "https://models.invalid/v1", model: "embed", dimension: 4 }, extraction: { endpoint: "https://models.invalid/v1", model: "extract" }
} };

it("accepts only handle-bound publication and distinguishes indeterminate outcomes without searchable claims", () => {
  const publish = { type: "shared-knowledge-index-publish", requestId: "publish", handleId: id, indexId: other };
  expect(request(publish)).toBe(true);
  for (const field of ["directory", "snapshot", "models", "grant", "permissionRevision", "headPageJson", "pointer"]) {
    expect(request({ ...publish, [field]: "forged" })).toBe(false);
  }
  const published = { type: "shared-knowledge-index-publish-result", requestId: "publish", ok: true, state: "published-local", snapshot: { epoch: id, cursor: "7" } };
  expect(result(published)).toBe(true);
  expect(result({ ...published, state: "searchable" })).toBe(false);
  expect(result({ ...published, snapshot: { epoch: id, cursor: "0" } })).toBe(false);
  expect(result({ ...published, pointer: {} })).toBe(false);
  const uncertain = { type: published.type, requestId: "publish", ok: false, errorCode: "PUBLICATION_INDETERMINATE" };
  expect(result(uncertain)).toBe(true);
  expect(result({ ...uncertain, type: "shared-knowledge-index-wait-result" })).toBe(false);
});

it("accepts metadata-only index handoff and refuses paths, secrets, grants or searchable claims", () => {
  expect(request(index)).toBe(true);
  expect(request({ type: "shared-knowledge-index-register", requestId: "register", handleId: id, indexId: other, workerRequestId: id })).toBe(true);
  expect(request({ type: "shared-knowledge-index-cancel", requestId: "cancel", handleId: id, indexId: other })).toBe(true);
  for (const field of ["python", "root", "scope", "userId", "grant", "arguments", "limits"]) expect(request({ ...index, [field]: "forged" })).toBe(false);
  expect(request({ ...index, models: { ...index.models, embedding: { ...index.models.embedding, apiKey: "synthetic" } } })).toBe(false);
  const ready = { type: "shared-knowledge-index-prepare-result", requestId: "prepare", ok: true, indexId: other };
  expect(result(ready)).toBe(true);
  expect(request({ type: "shared-knowledge-index-wait", requestId: "wait", handleId: id, indexId: other })).toBe(true);
  const verified = { type: "shared-knowledge-index-wait-result", requestId: "wait", ok: true, state: "verified-unpublished", snapshot: { epoch: id, cursor: "1" } };
  expect(result(verified)).toBe(true); expect(result({ ...verified, state: "searchable" })).toBe(false);
  for (const snapshot of [undefined, { epoch: null, cursor: "1" }, { epoch: id, cursor: "0" }, { epoch: id, cursor: "9223372036854775808" }, { epoch: id, cursor: "1", grant: true }]) {
    expect(result({ ...verified, snapshot })).toBe(false);
  }
  for (const field of ["directory", "documents", "searchable"]) expect(result({ ...ready, [field]: true })).toBe(false);
});
it("bounds index model selections to the native job contract", () => {
  for (const endpoint of ["http://localhost/v1", "https://u:p@models.invalid", "https://models.invalid/?key=value", "https://models.invalid/#hash", "https://models.invalid/\u0085"]) {
    expect(request({ ...index, models: { ...index.models, embedding: { ...index.models.embedding, endpoint } } })).toBe(false);
  }
  for (const dimension of [0, 3, 5, 4097, 65536]) expect(request({ ...index, models: { ...index.models, embedding: { ...index.models.embedding, dimension } } })).toBe(false);
  for (const model of ["", "with space", "x".repeat(129), "invalid\u0000"]) expect(request({ ...index, models: { ...index.models, extraction: { ...index.models.extraction, model } } })).toBe(false);
});

it("accepts scope-only opens and handle-bound appends/closes without granting access", () => {
  expect(request(open)).toBe(true);
  expect(request({ ...open, scope: { ...open.scope, scopeKind: "project", scopeId: other } })).toBe(true);
  expect(request(append)).toBe(true);
  expect(request({ type: "shared-knowledge-receipt-close", requestId: "close", handleId: id })).toBe(true);
});
it.each(["userId", "endpoint", "localProfileId", "root", "accessToken", "grant"])("rejects caller-supplied %s routing or authority", (field) => {
  expect(request({ ...open, [field]: "forged" })).toBe(false);
  expect(request({ ...open, scope: { ...open.scope, [field]: "forged" } })).toBe(false);
  expect(request({ ...append, [field]: "forged" })).toBe(false);
});
it("rejects team-scope mismatch and malformed handles or request IDs", () => {
  expect(request({ ...open, scope: { ...open.scope, scopeId: other } })).toBe(false);
  expect(request({ ...append, handleId: "../../receipt.json" })).toBe(false);
  expect(request({ ...append, requestId: "" })).toBe(false);
  expect(request({ ...append, requestId: "x".repeat(129) })).toBe(false);
});
it("bounds UTF-8 bytes, preserves valid Unicode and rejects lossy surrogate encoding", () => {
  expect(request({ ...append, pageJson: "x".repeat(2 * 1024 * 1024) })).toBe(true);
  expect(request({ ...append, pageJson: "中".repeat(800_000) })).toBe(false);
  expect(request({ ...append, pageJson: "x".repeat(2 * 1024 * 1024 + 1) })).toBe(false);
  expect(request({ ...append, pageJson: "😀中文" })).toBe(true);
  expect(request({ ...append, pageJson: "\uD800" })).toBe(false);
});
it("keeps bigint cursors exact and requires epochs for nonzero progress", () => {
  expect(request({ ...append, epoch: id, fromCursor: "9223372036854775807" })).toBe(true);
  for (const fromCursor of ["-1", "01", "9223372036854775808", "1e3"]) {
    expect(request({ ...append, epoch: id, fromCursor })).toBe(false);
  }
  expect(request({ ...append, fromCursor: "1" })).toBe(false);
});
it("allows only typed metadata or redacted failures in results", () => {
  const opened = { type: "shared-knowledge-receipt-open-result", requestId: "open", ok: true,
    handleId: id, userId: "user", endpoint: "https://fixture.invalid", progress: { epoch: null, cursor: "0" } };
  expect(result(opened)).toBe(true);
  expect(result({ ...opened, accessToken: "forged" })).toBe(false);
  expect(result({ ...opened, progress: { epoch: null, cursor: "1" } })).toBe(false);
  expect(result({ type: "shared-knowledge-receipt-append-result", requestId: "append", ok: true,
    progress: { epoch: id, cursor: "9223372036854775808" } })).toBe(false);
  const failure = { type: "shared-knowledge-receipt-append-result", requestId: "append", ok: false, errorCode: "STALE_HANDLE" };
  expect(result(failure)).toBe(true);
  expect(result({ ...failure, errorCode: "UNKNOWN" })).toBe(false);
  expect(result({ ...failure, message: "raw secret payload" })).toBe(false);
  expect(result({ type: "shared-knowledge-receipt-close-result", requestId: "close", ok: true })).toBe(true);
});
