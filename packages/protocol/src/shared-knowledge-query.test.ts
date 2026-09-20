import { expect, it } from "vitest";
import { isSharedKnowledgeReceiptRequest as request, isSharedKnowledgeReceiptResult as result } from "./shared-knowledge-receipt-broker.js";
const id = "00000000-0000-4000-8000-000000000001";
const prepare = { type: "shared-knowledge-index-query-prepare", requestId: "prepare", handleId: id };
const query = { type: "shared-knowledge-index-query", requestId: "query", handleId: id, queryId: id, vector: [1, 2, 3, 4], limit: 4 };
const prepared = { type: "shared-knowledge-index-query-prepare-result", requestId: "prepare", ok: true, queryId: id,
  model: { endpoint: "https://embed.invalid/v1", model: "embed", dimension: 4 }, snapshot: { epoch: id, cursor: "1" } };
const hit = { assetId: id, contentRevision: "a".repeat(64), score: 0.5 };
const queried = { type: "shared-knowledge-index-query-result", requestId: "query", ok: true, snapshot: prepared.snapshot, hits: [hit] };
it("admits only bounded query metadata and vectors, never paths, credentials or self-issued grants", () => {
  expect(request(prepare)).toBe(true); expect(request(query)).toBe(true); expect(result(prepared)).toBe(true); expect(result(queried)).toBe(true);
  for (const name of ["models", "directory", "python", "bootstrap", "grant", "scope", "assetIds", "query", "apiKey"]) {
    expect(request({ ...prepare, [name]: "forged" })).toBe(false); expect(request({ ...query, [name]: "forged" })).toBe(false);
  }
  expect(result({ ...queried, directory: "/private" })).toBe(false);
});
it.each([[], [1, 2, 3], [1, 2, 3, 4, 5], Array(4100).fill(0), [NaN, 0, 0, 0], [Infinity, 0, 0, 0], [1e39, 0, 0, 0], ["1", 0, 0, 0]].map(vector => ({ vector })))("rejects unsafe query vector %#", ({ vector }) => {
  expect(request({ ...query, vector })).toBe(false);
});
it.each([0, 101, 1.5])("rejects invalid limit %s", limit => { expect(request({ ...query, limit })).toBe(false); });
it.each([{ endpoint: "http://127.0.0.1" }, { endpoint: "https://user:pass@host.invalid" }, { model: "two models" }, { dimension: 5 }])("rejects invalid prepared model %#", change => {
  expect(result({ ...prepared, model: { ...prepared.model, ...change } })).toBe(false);
});
it.each([[hit, hit], [{ ...hit, score: Infinity }], [{ ...hit, contentRevision: "not-a-revision" }], [{ ...hit, body: "forbidden" }]].map(hits => ({ hits })))("rejects invalid/duplicate or body-bearing hits %#", ({ hits }) => {
  expect(result({ ...queried, hits })).toBe(false);
});
it("rejects empty or out-of-range publication snapshots and accepts explicit query failure", () => {
  expect(result({ ...prepared, snapshot: { epoch: id, cursor: "0" } })).toBe(false);
  expect(result({ ...queried, snapshot: { epoch: id, cursor: "9223372036854775808" } })).toBe(false);
  expect(result({ type: queried.type, requestId: "query", ok: false, errorCode: "QUERY_FAILED" })).toBe(true);
});
