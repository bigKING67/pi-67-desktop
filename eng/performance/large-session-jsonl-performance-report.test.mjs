import { describe, expect, it } from "vitest";
import {
  LARGE_SESSION_JSONL_PROFILES,
  resolveLargeSessionJsonlProfile,
  resolveLargeSessionJsonlSampleCount
} from "./large-session-jsonl-contract.mjs";
import { createLargeSessionJsonlPerformanceMetrics } from "./large-session-jsonl-performance-report.mjs";

describe("large Session JSONL certification contract", () => {
  it("keeps 500 MiB work opt-in while always certifying 100 MiB and 100,000 records", () => {
    expect(LARGE_SESSION_JSONL_PROFILES.standard).toEqual([
      expect.objectContaining({ totalBytes: 100 * 1024 * 1024, recordCount: 100_000 })
    ]);
    expect(LARGE_SESSION_JSONL_PROFILES.extended).toEqual([
      expect.objectContaining({ totalBytes: 100 * 1024 * 1024, recordCount: 100_000 }),
      expect.objectContaining({ totalBytes: 500 * 1024 * 1024, recordCount: 100_000 })
    ]);
  });

  it("rejects unknown profiles and excessive sample counts", () => {
    expect(() => resolveLargeSessionJsonlProfile("quick")).toThrow(/standard or extended/u);
    expect(() => resolveLargeSessionJsonlSampleCount("0")).toThrow(/1 to 5/u);
    expect(() => resolveLargeSessionJsonlSampleCount("6")).toThrow(/1 to 5/u);
  });

  it("creates structural metrics for every selected workload", () => {
    const workloads = LARGE_SESSION_JSONL_PROFILES.extended;
    const samples = Object.fromEntries(workloads.map((workload) => [workload.id, {
      durationMs: [100],
      fixtureWriteMs: [50],
      bytesProcessed: [workload.totalBytes],
      recordsProcessed: [workload.recordCount],
      passCount: [25],
      peakPendingLineBytes: [1024],
      eventLoopYieldCount: [24]
    }]));
    const metrics = createLargeSessionJsonlPerformanceMetrics(workloads, samples);

    expect(metrics).toHaveLength(14);
    expect(metrics.every((metric) => metric.evidenceLevel === "node-real-file-certification")).toBe(true);
    expect(metrics.find((metric) => metric.id === "sessionJsonlLarge500MiB100kRecords"))
      .toMatchObject({ p95: 100_000, unit: "count", status: "informational" });
  });
});
