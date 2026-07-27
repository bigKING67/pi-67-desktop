import { describe, expect, it } from "vitest";
import {
  SESSION_JSONL_TAIL_PERFORMANCE_BUDGETS,
  createSessionJsonlTailPerformanceMetrics
} from "./session-jsonl-tail-performance-report.mjs";

describe("Session JSONL tail performance contract", () => {
  it("keeps first-platform timings informational until macOS and Windows baselines exist", () => {
    expect(SESSION_JSONL_TAIL_PERFORMANCE_BUDGETS).toEqual({});
    const metrics = createSessionJsonlTailPerformanceMetrics(samples());
    expect(metrics).toHaveLength(20);
    expect(metrics.every((metric) => metric.status === "informational")).toBe(true);
    expect(metrics.every((metric) => metric.evidenceLevel === "node-real-file")).toBe(true);
  });

  it("reports bounded bytes, passes, pending-line memory and event-loop yields", () => {
    const metrics = new Map(createSessionJsonlTailPerformanceMetrics(samples()).map((metric) => [metric.id, metric]));
    expect(metrics.get("sessionJsonlTailBoundedDrain4MiBBytes")).toMatchObject({ p95: 4_194_304, unit: "bytes" });
    expect(metrics.get("sessionJsonlTailBoundedDrain4MiBPasses")).toMatchObject({ p95: 4, unit: "count" });
    expect(metrics.get("sessionJsonlTailBoundedDrain4MiBYields")).toMatchObject({ p95: 3, unit: "count" });
    expect(metrics.get("sessionJsonlTailBoundedDrain4MiBPeakPending")).toMatchObject({
      p95: 3_145_728,
      unit: "bytes"
    });
    expect(metrics.get("sessionJsonlTailBoundary64MiBPeakPending")).toMatchObject({
      p95: 67_108_864,
      unit: "bytes"
    });
    expect(metrics.get("sessionJsonlWatcherSequentialSelfAppend1000Records")).toMatchObject({ p95: 1_000 });
  });
});

function samples() {
  return {
    selfAppend1KiBDurationMs: [1],
    selfAppend256KiBDurationMs: [2],
    boundedDrain4MiBDurationMs: [3],
    boundedDrain4MiBBytesProcessed: [4_194_304],
    boundedDrain4MiBRecordsProcessed: [1],
    boundedDrain4MiBPassCount: [4],
    boundedDrain4MiBPeakPendingLineBytes: [3_145_728],
    boundedDrain4MiBEventLoopYieldCount: [3],
    boundary64MiBDurationMs: [100],
    boundary64MiBBytesProcessed: [67_108_865],
    boundary64MiBRecordsProcessed: [1],
    boundary64MiBPassCount: [17],
    boundary64MiBPeakPendingLineBytes: [67_108_864],
    boundary64MiBEventLoopYieldCount: [16],
    sequentialSelfAppend1000DurationMs: [50],
    sequentialSelfAppend1000BytesProcessed: [256_000],
    sequentialSelfAppend1000RecordsProcessed: [1_000],
    externalAppendDurationMs: [1],
    externalAppendBytesProcessed: [128],
    truncateDurationMs: [1],
    atomicReplaceDurationMs: [1],
    missingCreateDurationMs: [1],
    missingCreateBytesProcessed: [256],
    missingCreateRecordsProcessed: [2],
    generationDisposeRaceDurationMs: [1]
  };
}
