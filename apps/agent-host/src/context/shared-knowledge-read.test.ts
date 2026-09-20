import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { SharedKnowledgeReceiptResult } from "@pi67/protocol";
import { runSharedKnowledgeRead } from "./shared-knowledge-read.js";
import type { SharedKnowledgeReceiptClient } from "./shared-knowledge-receipt-client.js";
const id = "00000000-0000-4000-8000-000000000001", snapshot = { epoch: id, cursor: "1" };
const canonicalContent = JSON.stringify(["newmoney.knowledge.v1", "experience", "title", "summary", "body"]);
const contentRevision = createHash("sha256").update(canonicalContent).digest("hex");
function fixture() {
  const caller = new AbortController(), lifetime = new AbortController();
  const response: Extract<SharedKnowledgeReceiptResult, { type: "shared-knowledge-index-read-result"; ok: true }> = {
    type: "shared-knowledge-index-read-result", requestId: id, ok: true, snapshot, assetId: id, contentRevision, canonicalContent };
  const request = vi.fn<SharedKnowledgeReceiptClient["request"]>(async input => {
    if (input.type === "shared-knowledge-receipt-open") return { type: "shared-knowledge-receipt-open-result", requestId: id, ok: true,
      handleId: id, userId: "user", endpoint: "https://service.invalid", progress: { epoch: null, cursor: "0" } };
    if (input.type === "shared-knowledge-index-read") return response;
    return { type: "shared-knowledge-receipt-close-result", requestId: id, ok: true };
  });
  const options = { receipts: { request, signal: lifetime.signal }, scope: { teamId: id, scopeKind: "team" as const, scopeId: id },
    assetId: id, contentRevision, snapshot: { ...snapshot }, signal: caller.signal, assertCurrent: vi.fn() };
  return { request, caller, lifetime, options, response };
}
it("uses the distinct current-read operation and verifies the unchanged revision at a newer snapshot", async () => {
  const f = fixture(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (input, signal) => input.type === "shared-knowledge-index-read-current"
    ? { ...f.response, type: "shared-knowledge-index-read-current-result", snapshot: { ...snapshot, cursor: "2" } } : original(input, signal));
  expect(await runSharedKnowledgeRead({ ...f.options, snapshot: "current" })).toMatchObject({ snapshot: { ...snapshot, cursor: "2" }, contentRevision });
  expect(f.request.mock.calls[1]![0]).toEqual({ type: "shared-knowledge-index-read-current", handleId: id, assetId: id, contentRevision });
});
it("reads and hash-validates one selected body, then requires confirmed close", async () => {
  const f = fixture(); expect(await runSharedKnowledgeRead(f.options)).toEqual({ snapshot, assetId: id, contentRevision,
    content: { kind: "experience", title: "title", summary: "summary", body: "body" } });
  expect(f.request.mock.calls.map(([input]) => input.type)).toEqual(["shared-knowledge-receipt-open", "shared-knowledge-index-read", "shared-knowledge-receipt-close"]);
});
it.each(["snapshot", "asset", "revision", "hash", "content-shape", "operation", "denied"])("rejects %s mismatch without body output", async mode => {
  const f = fixture(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (input, signal) => {
    if (input.type !== "shared-knowledge-index-read") return original(input, signal);
    if (mode === "operation") return { type: "shared-knowledge-receipt-close-result", requestId: id, ok: true };
    if (mode === "denied") return { type: "shared-knowledge-index-read-result", requestId: id, ok: false, errorCode: "QUERY_FAILED" };
    if (mode === "snapshot") return { ...f.response, snapshot: { ...snapshot, cursor: "2" } };
    if (mode === "asset") return { ...f.response, assetId: "other" };
    if (mode === "revision") return { ...f.response, contentRevision: "a".repeat(64) };
    if (mode === "content-shape") {
      const body = JSON.stringify(["newmoney.knowledge.v1", "unknown", "title", "summary", "body"]), revision = createHash("sha256").update(body).digest("hex");
      return { ...f.response, contentRevision: revision, canonicalContent: body };
    }
    return { ...f.response, canonicalContent: canonicalContent.replace("body", "tampered") };
  });
  if (mode === "content-shape") f.options.contentRevision = createHash("sha256").update(JSON.stringify(["newmoney.knowledge.v1", "unknown", "title", "summary", "body"])).digest("hex");
  await expect(runSharedKnowledgeRead(f.options)).rejects.toThrow("Shared knowledge body unavailable.");
  expect(f.request.mock.calls.at(-1)![0].type).toBe("shared-knowledge-receipt-close");
});
it.each(["failure", "retired"])("does not return verified bytes when close is %s", async mode => {
  const f = fixture(), original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (input, signal) => {
    if (input.type === "shared-knowledge-receipt-close") {
      if (mode === "failure") throw new Error("synthetic sensitive detail");
      f.options.assertCurrent.mockImplementation(() => { throw new Error("retired"); });
    }
    return original(input, signal);
  });
  await expect(runSharedKnowledgeRead(f.options)).rejects.toThrow("unavailable");
});
it("closes promptly on cancellation and never delivers late body bytes", async () => {
  const f = fixture(), original = f.request.getMockImplementation()!; let release!: (result: SharedKnowledgeReceiptResult) => void;
  f.request.mockImplementation((input, signal) => input.type === "shared-knowledge-index-read" ? new Promise(resolve => { release = resolve; }) : original(input, signal));
  const pending = runSharedKnowledgeRead(f.options), rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(release).toBeDefined()); f.caller.abort();
  expect(f.request.mock.calls.at(-1)![0].type).toBe("shared-knowledge-receipt-close"); release(f.response); await rejected;
});
it("captures version, scope and snapshot before asynchronous IO", async () => {
  const f = fixture(), pending = runSharedKnowledgeRead(f.options);
  f.options.assetId = "other"; f.options.contentRevision = "other"; f.options.snapshot.cursor = "99"; f.options.scope.scopeId = "other";
  expect((await pending).assetId).toBe(id);
  expect(f.request.mock.calls[0]![0]).toMatchObject({ scope: { scopeId: id } });
  expect(f.request.mock.calls[1]![0]).toMatchObject({ snapshot, assetId: id, contentRevision });
});
