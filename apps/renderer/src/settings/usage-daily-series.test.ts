import type { UsageBucket, UsageReport } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  createDailyUsageSeries,
  showUsageDateLabel,
  usageAxisMaximum,
  usageAxisTicks
} from "./usage-daily-series.js";

describe("usage daily series", () => {
  it("fills every UTC date and aggregates all bucket dimensions for the same day", () => {
    const points = createDailyUsageSeries(report([
      bucket("2026-08-13", { input: 100, output: 20, cacheRead: 30, cacheWrite: 5, total: 155, recordedCost: 0.12 }),
      bucket("2026-08-13", { input: 10, output: 3, cacheRead: 0, cacheWrite: 0, total: 13, recordedCost: 0.01 }),
      bucket("2026-08-08", { input: 999, output: 0, cacheRead: 0, cacheWrite: 0, total: 999 })
    ]));

    expect(points.map((point) => point.date)).toEqual([
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
      "2026-08-17"
    ]);
    expect(points[0]?.totals).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
    expect(points[2]?.totals).toEqual({
      input: 110,
      output: 23,
      cacheRead: 30,
      cacheWrite: 5,
      total: 168,
      recordedCost: 0.13
    });
  });

  it("creates a stable five-tick axis above the observed maximum", () => {
    const points = createDailyUsageSeries(report([
      bucket("2026-08-13", { input: 3_004_537, output: 0, cacheRead: 0, cacheWrite: 0, total: 3_004_537 })
    ]));
    const maximum = usageAxisMaximum(points);

    expect(maximum).toBe(4_000_000);
    expect(usageAxisTicks(maximum)).toEqual([4_000_000, 3_000_000, 2_000_000, 1_000_000, 0]);
    expect(usageAxisMaximum(createDailyUsageSeries(report([])))).toBe(4);
  });

  it("reduces only label density for longer windows", () => {
    expect(Array.from({ length: 7 }, (_, index) => showUsageDateLabel(index, "7d")))
      .toEqual([true, true, true, true, true, true, true]);
    expect(Array.from({ length: 30 }, (_, index) => showUsageDateLabel(index, "30d"))
      .filter(Boolean)).toHaveLength(7);
    expect(Array.from({ length: 90 }, (_, index) => showUsageDateLabel(index, "90d"))
      .filter(Boolean)).toHaveLength(7);
  });
});

function report(buckets: UsageBucket[]): Pick<UsageReport, "buckets" | "generatedAt" | "window"> {
  return {
    buckets,
    generatedAt: Date.UTC(2026, 7, 17, 10, 2),
    window: "7d"
  };
}

function bucket(date: string, totals: UsageBucket["totals"]): UsageBucket {
  return {
    date,
    provider: "test",
    model: "test-model",
    source: "assistant-message",
    sessions: 1,
    turns: 1,
    totals
  };
}
