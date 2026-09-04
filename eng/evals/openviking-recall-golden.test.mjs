import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decideCheapRecall } from "./openviking-adaptive-policy.mjs";

const goldenPath = fileURLToPath(new URL("./openviking-recall-golden-set.json", import.meta.url));
const golden = JSON.parse(readFileSync(goldenPath, "utf8"));

describe("historical OpenViking adaptive-policy Golden Set", () => {
  it("meets the synthetic route-accuracy and deterministic latency budgets", () => {
    expect(golden.schema).toBe("pi67.openviking-recall-golden.v1");
    const results = golden.cases.map((testCase) => {
      const actual = decideCheapRecall(
        testCase.scores,
        testCase.configuredThreshold,
        testCase.canExpand
      );
      const latencyBudget = actual === "return-fast"
        ? golden.fastPathBudgetMs
        : golden.expandedPathBudgetMs;
      return {
        correct: actual === testCase.expectedDecision,
        withinBudget: testCase.estimatedLatencyMs <= latencyBudget
      };
    });
    const accuracy = results.filter((result) => result.correct).length / results.length;
    expect(accuracy).toBeGreaterThanOrEqual(golden.qualityThreshold);
    expect(results.every((result) => result.withinBudget)).toBe(true);
  });
});
