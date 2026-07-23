import { describe, expect, it } from "vitest";
import { droppedFrameRate, percentile, summarizeMetric } from "./performance-contract.mjs";

describe("performance report contract", () => {
  it("uses nearest-rank percentiles and evaluates a maximum budget", () => {
    const samples = [4, 1, 3, 2, 5, 6, 7, 8, 9, 10];
    expect(percentile([...samples].sort((left, right) => left - right), 0.5)).toBe(5);
    expect(percentile([...samples].sort((left, right) => left - right), 0.95)).toBe(10);
    expect(summarizeMetric({
      id: "launch",
      label: "Launch",
      unit: "ms",
      samples,
      budget: 9,
      evidenceLevel: "packaged",
      method: "fixture"
    }).status).toBe("fail");
  });

  it("estimates dropped frames relative to the observed refresh interval", () => {
    expect(droppedFrameRate([0, 16, 32, 48, 64])).toBe(0);
    expect(droppedFrameRate([0, 16, 48, 64])).toBeCloseTo(0.25);
  });
});
