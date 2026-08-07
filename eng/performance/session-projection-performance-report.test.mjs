import { describe, expect, it } from "vitest";
import {
  SESSION_PROJECTION_PERFORMANCE_BUDGETS,
  sessionProjectionMetrics
} from "./session-projection-performance-report.mjs";

describe("Session projection performance contract", () => {
  it("keeps the entry-scan and bounded page budgets explicit", () => {
    expect(SESSION_PROJECTION_PERFORMANCE_BUDGETS).toEqual({
      entryScans: 1,
      bootstrap10kMs: 100,
      olderPage10kMs: 50,
      recentPageBytes: 1_500_000
    });
  });

  it("passes representative samples inside every enforced budget", () => {
    const metrics = sessionProjectionMetrics(samples({
      entryScans10k: [1],
      entryScans100k: [1],
      bootstrap10k: [80],
      olderPage10k: [20],
      recentPageBytes10k: [20_000],
      recentPageBytes100k: [20_000]
    }));
    expect(metrics.filter((metric) => metric.budget !== undefined).every((metric) => metric.status === "pass"))
      .toBe(true);
  });

  it("fails when a projection performs more than one full SDK entry read", () => {
    const metric = sessionProjectionMetrics(samples({ entryScans10k: [2] }))
      .find((candidate) => candidate.id === "sessionProjectionEntryScans10k");
    expect(metric).toMatchObject({ status: "fail", p95: 2, budget: 1 });
  });

  it("fails when the 100,000-entry certification projection performs more than one full read", () => {
    const metric = sessionProjectionMetrics(samples({ entryScans100k: [2] }))
      .find((candidate) => candidate.id === "sessionProjectionEntryScans100k");
    expect(metric).toMatchObject({ status: "fail", p95: 2, budget: 1 });
  });
});

function samples(overrides = {}) {
  return {
    bind1k: [5],
    bind10k: [25],
    entryScans10k: [1],
    bootstrap1k: [5],
    bootstrap10k: [25],
    olderPage10k: [5],
    recentPageBytes10k: [20_000],
    bind100k: [250],
    entryScans100k: [1],
    bootstrap100k: [25],
    olderPage100k: [5],
    recentPageBytes100k: [20_000],
    ...overrides
  };
}
