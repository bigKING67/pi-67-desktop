import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { flattenCases, loadCorpus, memoryUri, otherPeerPrefix, splitGroups, validateCorpus } from "./corpus.mjs";
import { assertNoSecretLiterals, buildSummary, scoreCase } from "./metrics.mjs";
import { renderReport } from "./report.mjs";
import { readCredentials } from "./server.mjs";

const { corpus } = loadCorpus();
const cases = flattenCases(corpus);

describe("recall baseline corpus", () => {
  it("validates and resolves every expectation to a scoped synthetic URI", () => {
    expect(() => validateCorpus(corpus)).not.toThrow();
    for (const item of cases) {
      for (const uri of [...item.expectedUris, ...item.forbiddenUris]) expect(uri).toMatch(/^viking:\/\/user\/desktop\/(memories|peers\/ws-main\/memories)\//u);
    }
    const other = corpus.memories.filter((memory) => memory.scope === "other");
    expect(other.length).toBeGreaterThan(0);
    for (const memory of other) expect(memoryUri(corpus, memory).startsWith(otherPeerPrefix(corpus))).toBe(true);
  });

  it("rejects expectations that point at another peer's memory", () => {
    const broken = structuredClone(corpus);
    broken.cases[0].expect = ["peer-acme-stack"];
    expect(() => validateCorpus(broken)).toThrow(/another peer/u);
  });

  it("splits by group deterministically without leaking a group across splits", () => {
    const first = splitGroups(corpus);
    const second = splitGroups(structuredClone(corpus));
    expect([...first]).toEqual([...second]);
    const byGroup = new Map();
    for (const item of cases) {
      byGroup.set(item.group, new Set([...(byGroup.get(item.group) ?? []), item.split]));
    }
    for (const splits of byGroup.values()) expect(splits.size).toBe(1);
    for (const split of ["train", "test"]) {
      const slice = cases.filter((item) => item.split === split);
      for (const type of ["negative", "cross-peer"]) expect(slice.some((item) => item.type === type)).toBe(true);
      expect(slice.filter((item) => item.expectedUris.length > 0).length).toBeGreaterThanOrEqual(15);
    }
    const reseeded = splitGroups({ ...corpus, splitSeed: "another-seed" });
    expect([...reseeded]).not.toEqual([...first]);
  });
});

describe("recall baseline scoring", () => {
  const item = { expectedUris: ["u://a", "u://b"], forbiddenUris: ["u://old"] };
  const peer = "viking://user/desktop/peers/ws-acme/";

  it("ranks the first expected entry and flags stale intrusion above it", () => {
    const score = scoreCase(item, ["u://old", "u://b", "u://x"], peer);
    expect(score).toMatchObject({ rank: 2, hitAt1: false, hitAt3: true, reciprocalRank: 0.5, fullRecall: false, forbiddenIntrusion: true, irrelevantEntries: 2 });
    expect(scoreCase(item, ["u://a", "u://old", "u://b"], peer)).toMatchObject({ rank: 1, fullRecall: true, forbiddenIntrusion: false });
  });

  it("counts negative false injection and other-peer leakage", () => {
    const negative = { expectedUris: [], forbiddenUris: [] };
    expect(scoreCase(negative, [], peer)).toMatchObject({ falseInjection: false, otherPeerLeak: false, hitAt3: false });
    expect(scoreCase(negative, [`${peer}memories/x.md`], peer)).toMatchObject({ falseInjection: true, otherPeerLeak: true });
  });

  it("aggregates per split and type and reports repetition spread", () => {
    const make = (repetition, split, type, returned, expected, extra = {}) => {
      const caseItem = { expectedUris: expected, forbiddenUris: [] };
      return { arm: "product", repetition, caseId: `${type}-${split}`, split, type, expectedCount: expected.length, forbiddenCount: 0,
        returnedUris: returned, scores: [], usedTokens: 100, latencyMs: 10 * repetition, score: scoreCase(caseItem, returned, peer), ...extra };
    };
    const results = [
      make(1, "train", "direct", ["u://a"], ["u://a"]),
      make(1, "test", "negative", ["u://z"], []),
      make(2, "train", "direct", ["u://x", "u://a"], ["u://a"]),
      make(2, "test", "negative", [], []),
    ];
    const summary = buildSummary(results).product;
    expect(summary.overall).toMatchObject({ cases: 4, hitAt1: 0.5, hitAt3: 1, falseInjection: 0.5, fullRecall: null });
    expect(summary.bySplit.train.meanReciprocalRank).toBeCloseTo(0.75);
    expect(summary.byType.negative.hitAt1).toBeNull();
    expect(summary.repetitionSpread.hitAt1).toEqual({ min: 0, max: 1, stdev: 0.5 });
    const report = renderReport({
      runId: "r", server: { version: "0.4.16" }, embedding: { model: "m", dimension: 3 }, corpus: { sha256: "a".repeat(64) },
      repetitions: 2, source: { gitHead: "b".repeat(40), dirty: false, runnerSha256: "c".repeat(64) },
      cleanup: { dataRootRemoved: true, processExited: true }, summary: { product: summary },
    });
    expect(report).toContain("| train | 2 |");
    expect(report).toContain("cleanup verified");
  });
});

describe("recall baseline credential handling", () => {
  it("requires an external owner-only file and never exposes keys publicly", () => {
    const directory = mkdtempSync(join(tmpdir(), "pi67-baseline-test-"));
    try {
      const path = join(directory, "credentials.json");
      const secretValue = "sk-test-secret-value-123456";
      writeFileSync(path, JSON.stringify({ embedding: { api_base: "https://embed.example/v1", model: "BAAI/bge-m3", api_key: secretValue, dimension: 1024 } }), { mode: 0o644 });
      expect(() => readCredentials(path, { withExpansion: false })).toThrow(/group\/world/u);
      chmodSync(path, 0o600);
      const credentials = readCredentials(path, { withExpansion: false });
      expect(JSON.stringify(credentials.public)).not.toContain(secretValue);
      expect(credentials.public.vlm).toBeNull();
      expect(() => readCredentials(path, { withExpansion: true })).toThrow(/vlm/u);
      expect(() => assertNoSecretLiterals(`x${secretValue}x`, [secretValue])).toThrow(/credential literal/u);
      expect(() => assertNoSecretLiterals("clean", [secretValue, null])).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
