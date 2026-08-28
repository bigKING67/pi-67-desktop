import { describe, expect, it } from "vitest";
import { createRendererMemoryMetrics, excludeDocumentHeadNodes } from "./renderer-memory.mjs";

describe("renderer memory performance contract", () => {
  it("keeps retained heap and DOM budgets explicit", () => {
    const metrics = createRendererMemoryMetrics(fixture(), (metric) => metric);

    expect(metrics.find((metric) => metric.id === "rendererLoaded1kHeapDelta")?.budget).toBe(6);
    expect(metrics.find((metric) => metric.id === "rendererAfter10SwitchesHeapDelta")?.budget).toBe(8);
    expect(metrics.find((metric) => metric.id === "rendererLoaded1kDomNodes")?.budget).toBe(1_000);
    expect(metrics.find((metric) => metric.id === "rendererAfter10SwitchesDomNodes")?.budget).toBe(800);
  });

  it("calculates per-sample retained heap deltas against the restored Session", () => {
    const metrics = createRendererMemoryMetrics(fixture(), (metric) => metric);

    expect(metrics.find((metric) => metric.id === "rendererLoaded1kHeapDelta")?.samples).toEqual([3, 4]);
    expect(metrics.find((metric) => metric.id === "rendererAfter10SwitchesHeapDelta")?.samples).toEqual([2, 3]);
  });

  it("excludes invariant document-head nodes without hiding detached body nodes", () => {
    expect(excludeDocumentHeadNodes(832, 32)).toBe(800);
    expect(excludeDocumentHeadNodes(12, 20)).toBe(0);
  });
});

function fixture() {
  return {
    welcomeHeap: [3, 3],
    restoredHeap: [7, 8],
    loadedHeap: [10, 12],
    switchedHeap: [9, 11],
    loadedNodes: [700, 720],
    switchedNodes: [320, 330]
  };
}
