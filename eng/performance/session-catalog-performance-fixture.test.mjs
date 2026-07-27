import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SESSION_CATALOG_NEEDLE_INDEX,
  assertMetadataOnlyRecords,
  createSessionCatalogRecords
} from "./session-catalog-performance-fixture.mjs";
import {
  SESSION_CATALOG_PERFORMANCE_BUDGETS,
  createSessionCatalogPerformanceMetrics
} from "./session-catalog-performance-report.mjs";

const ALLOWED_KEYS = [
  "cwd",
  "cwdKey",
  "explicitName",
  "id",
  "messageCount",
  "modifiedAt",
  "path"
];
const BANNED_CONTENT_KEYS = [
  "allMessagesText",
  "assistant",
  "dataUrl",
  "firstMessage",
  "image",
  "messages",
  "patch",
  "prompt",
  "source",
  "sourceBody",
  "thinking",
  "tool",
  "toolPayload",
  "transcript"
];

describe("Session Catalog performance fixture", () => {
  it("generates unique, descending, metadata-only records", () => {
    const workspace = resolve("/tmp/pi67-session-catalog-fixture");
    const records = createSessionCatalogRecords(10_000, workspace);

    expect(records).toHaveLength(10_000);
    expect(new Set(records.map((record) => record.id))).toHaveLength(10_000);
    expect(new Set(records.map((record) => record.path))).toHaveLength(10_000);
    expect(new Set(records.map((record) => record.explicitName))).toHaveLength(10_000);
    expect(records.every((record, index) => index === 0 || record.modifiedAt < records[index - 1].modifiedAt)).toBe(true);
    expect(records[SESSION_CATALOG_NEEDLE_INDEX].explicitName).toBe("Session catalog needle 06789");

    assertMetadataOnlyRecords(records);
    for (const record of records) {
      expect(Object.keys(record).sort()).toEqual(ALLOWED_KEYS);
      for (const key of BANNED_CONTENT_KEYS) expect(record).not.toHaveProperty(key);
    }
  });

  it("rejects any non-metadata field", () => {
    const [record] = createSessionCatalogRecords(1, resolve("/tmp/pi67-session-catalog-fixture"));
    expect(() => assertMetadataOnlyRecords([{ ...record, transcript: "forbidden" }])).toThrow(/non-metadata field transcript/u);
  });
});

describe("Session Catalog performance report", () => {
  it("keeps the approved warm-query and page-size budgets", () => {
    expect(SESSION_CATALOG_PERFORMANCE_BUDGETS).toEqual({
      warmFirstPage1kMs: 50,
      warmFirstPage10kMs: 100,
      searchMiss10kMs: 150,
      pageBytes10k: 1_500_000
    });
  });

  it("passes samples inside all enforced budgets", () => {
    const metrics = createSessionCatalogPerformanceMetrics(createSamples());
    expect(metrics.filter((metric) => metric.budget !== undefined).every((metric) => metric.status === "pass")).toBe(true);
  });

  it("fails a warm-query sample outside its enforced budget", () => {
    const samples = createSamples();
    samples.warmFirstPage10k = [101];
    const metric = createSessionCatalogPerformanceMetrics(samples)
      .find((candidate) => candidate.id === "sessionCatalogWarmFirstPage10k");
    expect(metric?.status).toBe("fail");
  });
});

function createSamples() {
  return {
    coldRebuild1k: [10],
    coldRebuild10k: [100],
    warmFirstPage1k: [49],
    warmFirstPage10k: [99],
    warmNextPage10k: [10],
    searchHit10k: [10],
    searchMiss10k: [149],
    pageBytes10k: [1_499_999],
    reopen10k: [10]
  };
}
