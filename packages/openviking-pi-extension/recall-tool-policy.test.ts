import { describe, expect, it } from "vitest";
import {
  cheapRecallCandidateLimit,
  decideCheapRecall,
  FAST_RECALL_EMPTY_CACHE_MS,
  FAST_RECALL_POSITIVE_CACHE_MS,
  RecallToolCache,
  recallCacheKey,
} from "./recall-tool-policy.js";

describe("OpenViking cheap-first Tool recall policy", () => {
  it("returns one strong unambiguous vector hit without expansion", () => {
    expect(decideCheapRecall([0.86, 0.61], 0.35, true)).toBe("return-fast");
    expect(decideCheapRecall([0.8], 0.35, true)).toBe("return-fast");
  });

  it("upgrades empty, weak, and ambiguous candidates", () => {
    expect(decideCheapRecall([], 0.35, true)).toBe("expand");
    expect(decideCheapRecall([0.64], 0.35, true)).toBe("expand");
    expect(decideCheapRecall([0.83, 0.78], 0.35, true)).toBe("expand");
  });

  it("keeps the cheap result when session-aware expansion is unavailable", () => {
    expect(decideCheapRecall([], 0.35, false)).toBe("return-fast");
    expect(decideCheapRecall([0.4], 0.35, false)).toBe("return-fast");
  });

  it("oversamples only enough to judge ambiguity and stays bounded", () => {
    expect(cheapRecallCandidateLimit(1)).toBe(5);
    expect(cheapRecallCandidateLimit(5)).toBe(7);
    expect(cheapRecallCandidateLimit(8)).toBe(8);
  });

  it("uses shorter empty caching, LRU eviction, and scoped stable keys", () => {
    let now = 100;
    const cache = new RecallToolCache<string>(2, () => now);
    cache.set("empty", "none", true);
    cache.set("positive", "hit", false);
    now += FAST_RECALL_EMPTY_CACHE_MS;
    expect(cache.get("empty")).toBeUndefined();
    expect(cache.get("positive")).toBe("hit");
    now = 100 + FAST_RECALL_POSITIVE_CACHE_MS;
    expect(cache.get("positive")).toBeUndefined();

    cache.set("a", "a", false);
    cache.set("b", "b", false);
    expect(cache.get("a")).toBe("a");
    cache.set("c", "c", false);
    expect(cache.get("b")).toBeUndefined();
    expect(recallCacheKey({ query: "  Host Crash ", scope: "viking://x", limit: 2, sessionId: "s" }))
      .toBe(recallCacheKey({ query: "host crash", scope: "viking://x", limit: 2, sessionId: "s" }));
  });
});
