import { describe, expect, it } from "vitest";
import { readContextServerTiming, withContextTiming } from "./recall-timing.js";

describe("context timing boundary", () => {
  it("requests only a summary without changing retrieval/model inputs", () => {
    const body = { mode: "context", query: "synthetic", session_id: "session", query_expansion: "auto", dedup_turns: 5 };
    const signal = new AbortController().signal;
    const request = { method: "POST", body: JSON.stringify(body), signal };
    expect(withContextTiming(request)?.signal).toBe(signal);
    const projectedBody = withContextTiming(request)?.body;
    if (typeof projectedBody !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(projectedBody)).toEqual({ ...body, telemetry: { summary: true } });
    expect(JSON.parse(request.body)).toEqual(body);
    for (const other of [undefined, { method: "GET" }, { method: "POST", body: "bad json" },
      { method: "POST", body: "null" }, { method: "POST", body: '{"mode":"list"}' }]) {
      expect(withContextTiming(other)).toBe(other);
    }
  });

  it("keeps only allowlisted numeric durations, with absent stages left unknown", () => {
    expect(readContextServerTiming({ id: "sensitive-id", summary: {
      operation: "search.context", status: "ok", duration_ms: 6000.4,
      query: "secret", errors: { message: "secret" }, tokens: { total: 50 },
      search: { embed_query: { duration_ms: 1200.7, query: "secret" }, vector_retrieval: { duration_ms: 60 },
        unrelated_stage: { duration_ms: 3 } },
    } })).toEqual({ durationMs: 6000, embedQueryMs: 1201, vectorRetrievalMs: 60 });
    expect(readContextServerTiming({ summary: { operation: "search.context", status: "ok", duration_ms: 0 } }))
      .toEqual({ durationMs: 0 });
  });

  it("rejects bad totals, other operations, failures and malformed summaries", () => {
    for (const value of [undefined, null, [], {}, { summary: [] },
      { summary: { operation: "search.search", status: "ok", duration_ms: 5 } },
      { summary: { operation: "search.context", status: "error", duration_ms: 5 } }]) {
      expect(readContextServerTiming(value)).toBeUndefined();
    }
    for (const value of [undefined, null, "12", -1, NaN, Infinity, 600_001]) {
      expect(readContextServerTiming({ summary: { operation: "search.context", status: "ok", duration_ms: value } }))
        .toBeUndefined();
      expect(readContextServerTiming({ summary: { operation: "search.context", status: "ok", duration_ms: 1,
        search: { embed_query: { duration_ms: value } } } })).toEqual({ durationMs: 1 });
    }
  });
});
