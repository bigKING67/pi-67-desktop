import { describe, expect, it } from "vitest";
import { createSessionOpenPerformanceMetrics } from "./session-open-performance-report.mjs";

describe("Session open performance report", () => {
  it("reports the authoritative open, event-loop, projection, page, and memory boundaries", () => {
    const metrics = createSessionOpenPerformanceMetrics([
      { id: "10MiB", label: "10 MiB", metricSuffix: "10MiB" }
    ], {
      "10MiB": {
        openMs: [20],
        eventLoopDelayMs: [21],
        projectionBindMs: [10],
        firstPageMs: [1],
        userMessagePageMs: [2],
        retainedRssBytes: [2_000_000],
        retainedHeapBytes: [1_000_000],
        messageCount: [2_560],
        fixtureBytes: [10 * 1024 * 1024],
        fixtureWriteMs: [5],
        firstPageBytes: [20_000],
        userMessagePageBytes: [15_000]
      }
    });

    expect(metrics.map((metric) => metric.id)).toEqual([
      "sessionOpen10MiBOpen",
      "sessionOpen10MiBEventLoopDelay",
      "sessionOpen10MiBProjectionBind",
      "sessionOpen10MiBFirstPage",
      "sessionOpen10MiBUserMessagePage",
      "sessionOpen10MiBRetainedRss",
      "sessionOpen10MiBRetainedHeap",
      "sessionOpen10MiBMessages",
      "sessionOpen10MiBFixtureBytes",
      "sessionOpen10MiBFixtureWrite",
      "sessionOpen10MiBFirstPageBytes",
      "sessionOpen10MiBUserMessagePageBytes"
    ]);
    expect(metrics.every((metric) => metric.evidenceLevel === "node-real-file")).toBe(true);
  });
});
