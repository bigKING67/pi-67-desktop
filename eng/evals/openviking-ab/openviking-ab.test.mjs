import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { decideCheapRecall } from "../openviking-adaptive-policy.mjs";
import { flattenCases, loadCorpus } from "./corpus.mjs";
import {
  assertArtifactSafe,
  percentile,
  summarizeAdaptiveReplays,
  summarizeProfile,
} from "./metrics.mjs";
import { accountExists, readRootKey } from "./openviking-lab.mjs";
import {
  decideAdaptiveRoute,
  FAST_RECALL_SCORE_FLOOR,
  FAST_RECALL_SCORE_MARGIN,
} from "./policy.mjs";

describe("OpenViking A/B retrieval pilot", () => {
  it("keeps the frozen pilot policy aligned with its historical candidate", () => {
    expect(FAST_RECALL_SCORE_FLOOR).toBe(0.72);
    expect(FAST_RECALL_SCORE_MARGIN).toBe(0.1);
    for (const sample of [
      { scores: [], threshold: 0.35, canExpand: true },
      { scores: [0.88], threshold: 0.35, canExpand: true },
      { scores: [0.83, 0.78], threshold: 0.35, canExpand: true },
      { scores: [0.58], threshold: 0.35, canExpand: true },
      { scores: [0.58], threshold: 0.35, canExpand: false },
    ]) {
      const product = decideCheapRecall(sample.scores, sample.threshold, sample.canExpand);
      const pilot = decideAdaptiveRoute(sample.scores, sample.threshold, sample.canExpand);
      expect(pilot).toBe(product === "return-fast" ? "find-fast" : "context-expanded");
    }
  });

  it("loads sixty frozen synthetic queries pinned to an upstream commit", () => {
    const { corpus, sha256 } = loadCorpus();
    const cases = flattenCases(corpus, "viking://resources/pi67-ab-retrieval");
    expect(corpus.documents).toHaveLength(12);
    expect(cases).toHaveLength(60);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(corpus.officialUpstream.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(corpus.controlledConfiguration.failureBudget).toBe(3);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
  });

  it("computes deterministic retrieval and latency summaries", () => {
    const summary = summarizeProfile("pi67-adaptive", [
      result(["expected"], 100, 1, "find-fast"),
      result(["other", "expected"], 300, 2, "context-expanded"),
      result([], 200, 2, "context-expanded"),
    ]);
    expect(summary).toMatchObject({
      cases: 3,
      hitAt1: 0.3333,
      hitAt3: 0.6667,
      meanReciprocalRank: 0.5,
      totalRequests: 5,
      p50LatencyMs: 200,
      p95LatencyMs: 300,
      failures: 0,
    });
    expect(percentile([9, 1, 5], 0.5)).toBe(5);
  });

  it("replays lower adaptive thresholds without another live request", () => {
    const replays = summarizeAdaptiveReplays([
      {
        ...result(["expected"], 300, 2, "context-expanded"),
        findReturnedUris: ["expected"],
        findScores: [0.6],
        findLatencyMs: 100,
        contextLatencyMs: 200,
      },
    ], 0.35);
    expect(replays.find((item) => item.scoreFloor === 0.55 && item.scoreMargin === 0.1))
      .toMatchObject({ hitAt1: 1, totalRequests: 1, p95LatencyMs: 100 });
    expect(replays.find((item) => item.scoreFloor === 0.65 && item.scoreMargin === 0.1))
      .toMatchObject({ hitAt1: 1, totalRequests: 2, p95LatencyMs: 300 });
  });

  it("rejects credential-shaped artifacts and reads only an external root config", async () => {
    expect(() => assertArtifactSafe({ api_key: "secret" })).toThrow(/credential-like/);
    expect(() => assertArtifactSafe({ authorization: "Bearer abcdefghijklmnop" })).toThrow(/credential-like/);
    expect(() => assertArtifactSafe({ accountId: "synthetic", score: 0.8 })).not.toThrow();

    const root = await mkdtemp(join(tmpdir(), "pi67-openviking-ab-test-"));
    const configPath = join(root, "ov.conf");
    try {
      await writeFile(configPath, JSON.stringify({ server: { root_api_key: "test-only-key" } }));
      expect(readRootKey(configPath)).toBe("test-only-key");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("settles synthetic Account absence from the bounded admin inventory", () => {
    const inventory = { result: [{ account_id: "other" }, { account_id: "pi67-ab-one" }] };
    expect(accountExists(inventory, "pi67-ab-one")).toBe(true);
    expect(accountExists(inventory, "pi67-ab-two")).toBe(false);
  });
});

function result(returnedUris, latencyMs, requestCount, route) {
  return {
    expectedUri: "expected",
    returnedUris,
    latencyMs,
    requestCount,
    route,
  };
}
