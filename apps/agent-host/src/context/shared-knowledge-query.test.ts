import { expect, it, vi } from "vitest";
import type { SharedKnowledgeReceiptResult } from "@pi67/protocol";
import { runSharedKnowledgeQuery } from "./shared-knowledge-query.js";
import { SharedKnowledgeReceiptClient } from "./shared-knowledge-receipt-client.js";

const id = "00000000-0000-4000-8000-000000000001";
const snapshot = { epoch: id, cursor: "1" }, model = { endpoint: "https://embed.invalid/v1", model: "embed", dimension: 4 };
const hit = { assetId: id, contentRevision: "a".repeat(64), score: 0.7 };
function fixture() {
  const caller = new AbortController(), client = new AbortController(), order: string[] = [];
  const response = (type: string): SharedKnowledgeReceiptResult => {
    const base = { requestId: id, ok: true as const };
    switch (type) {
      case "shared-knowledge-receipt-open": return { ...base, type: "shared-knowledge-receipt-open-result", handleId: id,
        userId: "user", endpoint: "https://service.invalid", progress: { epoch: null, cursor: "0" } };
      case "shared-knowledge-index-query-prepare": return { ...base, type: "shared-knowledge-index-query-prepare-result", queryId: id, model, snapshot };
      case "shared-knowledge-index-query": return { ...base, type: "shared-knowledge-index-query-result", snapshot, hits: [hit] };
      default: return { ...base, type: "shared-knowledge-receipt-close-result" };
    }
  };
  const request = vi.fn<SharedKnowledgeReceiptClient["request"]>(async input => { order.push(input.type); return response(input.type); });
  const embed = vi.fn(async () => { order.push("embedding"); return [1, 2, 3, 4]; });
  const options = { receipts: { request, signal: client.signal }, scope: { teamId: "team", scopeKind: "project" as const, scopeId: "project" },
    query: "query", limit: 1, signal: caller.signal, assertCurrent: vi.fn(), embed };
  return { caller, client, order, request, embed, options, response };
}
it("prepares Main's exact model before embedding and returns only matching metadata after close", async () => {
  const f = fixture();
  expect(await runSharedKnowledgeQuery(f.options)).toEqual({ snapshot, hits: [hit] });
  expect(f.order).toEqual(["shared-knowledge-receipt-open", "shared-knowledge-index-query-prepare", "embedding", "shared-knowledge-index-query", "shared-knowledge-receipt-close"]);
  expect(f.embed).toHaveBeenCalledWith("query", model, expect.any(AbortSignal));
  expect(f.request.mock.calls[2]![0]).toEqual({ type: "shared-knowledge-index-query", handleId: id, queryId: id, vector: [1, 2, 3, 4], limit: 1 });
});
it.each(["shared-knowledge-receipt-open", "shared-knowledge-index-query-prepare", "shared-knowledge-index-query", "shared-knowledge-receipt-close"])("rejects %s failure without retry", async phase => {
  const f = fixture(), base = f.request.getMockImplementation()!;
  f.request.mockImplementation((input, signal) => input.type === phase ? Promise.reject(new Error("synthetic detail")) : base(input, signal));
  await expect(runSharedKnowledgeQuery(f.options)).rejects.toThrow("Shared knowledge query unavailable.");
  expect(f.request.mock.calls.filter(([input]) => input.type === phase)).toHaveLength(1);
  if (phase.endsWith("open") || phase.endsWith("prepare")) expect(f.embed).not.toHaveBeenCalled();
});
it.each(["epoch", "cursor", "count", "operation", "denied"])("withholds mismatched query result: %s", async kind => {
  const f = fixture(), base = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (input, signal) => {
    if (input.type !== "shared-knowledge-index-query") return base(input, signal);
    const result = f.response(input.type);
    if (result.type !== "shared-knowledge-index-query-result" || !result.ok) throw new Error("fixture");
    if (kind === "operation") return f.response("shared-knowledge-receipt-close");
    if (kind === "denied") return { type: result.type, requestId: id, ok: false, errorCode: "QUERY_FAILED" };
    return { ...result, snapshot: { ...snapshot, ...(kind === "epoch" ? { epoch: "other" } : kind === "cursor" ? { cursor: "2" } : {}) },
      hits: kind === "count" ? [hit, { ...hit, assetId: "other" }] : [hit] };
  });
  await expect(runSharedKnowledgeQuery(f.options)).rejects.toThrow("unavailable");
  expect(f.request.mock.calls.at(-1)![0].type).toBe("shared-knowledge-receipt-close");
});
it.each(["caller", "client"])("closes during cancelled embedding and drains its late completion: %s", async kind => {
  const f = fixture(); let release!: (vector: number[]) => void, settled = false;
  f.embed.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const run = runSharedKnowledgeQuery(f.options).finally(() => { settled = true; }), rejected = expect(run).rejects.toThrow("unavailable");
  await vi.waitFor(() => expect(f.embed).toHaveBeenCalledOnce()); f[kind as "caller" | "client"].abort();
  await vi.waitFor(() => expect(f.request.mock.calls.at(-1)![0].type).toBe("shared-knowledge-receipt-close"));
  expect(settled).toBe(false); release([1, 2, 3, 4]); await rejected;
  expect(f.request.mock.calls.some(([input]) => input.type === "shared-knowledge-index-query")).toBe(false);
  expect(f.request.mock.calls.filter(([input]) => input.type === "shared-knowledge-receipt-close")).toHaveLength(1);
});
it("closes a late successful open even if cancellation preceded handle delivery", async () => {
  const f = fixture(); let release!: (result: SharedKnowledgeReceiptResult) => void;
  f.request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const run = runSharedKnowledgeQuery(f.options), rejected = expect(run).rejects.toThrow();
  f.caller.abort(); release(f.response("shared-knowledge-receipt-open")); await rejected;
  expect(f.request.mock.calls.at(-1)![0]).toEqual({ type: "shared-knowledge-receipt-close", handleId: id }); expect(f.embed).not.toHaveBeenCalled();
});
it("rejects a cancelled or invalidated result during close acknowledgement", async () => {
  const f = fixture(), base = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (input, signal) => {
    if (input.type === "shared-knowledge-receipt-close") f.options.assertCurrent.mockImplementation(() => { throw new Error("retired"); });
    return base(input, signal);
  });
  await expect(runSharedKnowledgeQuery(f.options)).rejects.toThrow("unavailable");
});
it("captures scope, text and limit before the first await", async () => {
  const f = fixture(), run = runSharedKnowledgeQuery(f.options);
  f.options.scope.scopeId = "other"; f.options.query = "other"; f.options.limit = 99;
  await run;
  expect(f.request.mock.calls[0]![0]).toMatchObject({ scope: { scopeId: "project" } });
  expect(f.embed).toHaveBeenCalledWith("query", model, expect.anything());
  expect(f.request.mock.calls[2]![0]).toMatchObject({ limit: 1 });
});

it.each([
  ["shared-knowledge-receipt-open", "receipt-open"],
  ["shared-knowledge-index-query-prepare", "index-preparation"],
  ["embedding", "embedding"],
  ["shared-knowledge-index-query", "native-query"],
  ["shared-knowledge-receipt-close", "receipt-close"]
])("reports only the fixed stage for %s and never its payload", async (operation, stage) => {
  const f = fixture(), base = f.request.getMockImplementation()!;
  const detail = new Error("synthetic private endpoint/key/query/body");
  if (operation === "embedding") f.embed.mockRejectedValue(detail);
  else f.request.mockImplementation((input, signal) => input.type === operation ? Promise.reject(detail) : base(input, signal));
  const error = await runSharedKnowledgeQuery(f.options).catch((value: unknown) => value);
  expect(error).toMatchObject({ message: `Shared knowledge query unavailable. Stage: ${stage}.`, stage });
  expect(error).not.toHaveProperty("cause");
  expect(JSON.stringify(error)).not.toContain("synthetic");
  expect(f.request.mock.calls.filter(([input]) => input.type === "shared-knowledge-receipt-close")).toHaveLength(operation.endsWith("open") ? 0 : 1);
  if (stage === "receipt-open" || stage === "index-preparation") expect(f.embed).not.toHaveBeenCalled();
});

it("preserves the primary failed stage when cleanup also fails", async () => {
  const f = fixture(), base = f.request.getMockImplementation()!;
  f.request.mockImplementation((input, signal) => input.type === "shared-knowledge-index-query-prepare" || input.type === "shared-knowledge-receipt-close"
    ? Promise.reject(new Error("synthetic detail")) : base(input, signal));
  await expect(runSharedKnowledgeQuery(f.options)).rejects.toMatchObject({ stage: "index-preparation" });
  expect(f.embed).not.toHaveBeenCalled();
});

it("reports cancellation at the pending preparation, not its independent close", async () => {
  const f = fixture(), pending = Promise.withResolvers<SharedKnowledgeReceiptResult>(), base = f.request.getMockImplementation()!;
  f.request.mockImplementation((input, signal) => input.type === "shared-knowledge-index-query-prepare" ? pending.promise : base(input, signal));
  const rejected = expect(runSharedKnowledgeQuery(f.options)).rejects.toMatchObject({ stage: "index-preparation" });
  await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2));
  f.caller.abort(); pending.resolve(f.response("shared-knowledge-index-query-prepare")); await rejected;
  expect(f.embed).not.toHaveBeenCalled();
  expect(f.request.mock.calls.filter(([input]) => input.type === "shared-knowledge-receipt-close")).toHaveLength(1);
});

it("keeps the preparation stage after the real IPC timeout and refuses a late reply", async () => {
  vi.useFakeTimers(); const f = fixture();
  let preparationId: string | undefined;
  const client = new SharedKnowledgeReceiptClient({ postMessage(message) {
    f.order.push(message.type);
    if (message.type === "shared-knowledge-index-query-prepare") preparationId = message.requestId;
    else client.handleResult({ ...f.response(message.type), requestId: message.requestId });
  } }, { userId: "user", endpoint: "https://service.invalid" });
  try {
    const rejected = expect(runSharedKnowledgeQuery({ ...f.options, receipts: client,
      scope: { teamId: id, scopeKind: "project", scopeId: id } })).rejects.toMatchObject({ stage: "index-preparation" });
    await vi.advanceTimersByTimeAsync(69_999);
    expect(preparationId).toBeDefined(); expect(f.order).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); await rejected;
    expect(f.embed).not.toHaveBeenCalled();
    expect(f.order.filter(operation => operation === "shared-knowledge-index-query-prepare")).toHaveLength(1);
    expect(f.order.at(-1)).toBe("shared-knowledge-receipt-close");
    expect(client.handleResult({ ...f.response("shared-knowledge-index-query-prepare"), requestId: preparationId! })).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally { client.shutdown(); vi.useRealTimers(); }
});
