import { describe, expect, it } from "vitest";
import { planAgentHostRestart } from "./agent-host-restart.js";

describe("Agent Host restart policy", () => {
  it("uses bounded exponential backoff for the first three recent exits", () => {
    const first = planAgentHostRestart([], 1_000);
    const second = planAgentHostRestart(first.history, 2_000);
    const third = planAgentHostRestart(second.history, 3_000);

    expect(first).toMatchObject({ recoverable: true, attempt: 1, delay: 500 });
    expect(second).toMatchObject({ recoverable: true, attempt: 2, delay: 1_000 });
    expect(third).toMatchObject({ recoverable: true, attempt: 3, delay: 2_000 });
    expect(planAgentHostRestart(third.history, 4_000)).toEqual({
      history: [1_000, 2_000, 3_000],
      recoverable: false
    });
  });

  it("forgets exits outside the rolling one-minute window", () => {
    expect(planAgentHostRestart([0, 10_000, 20_000], 70_000)).toEqual({
      history: [20_000, 70_000],
      recoverable: true,
      attempt: 2,
      delay: 1_000
    });
  });
});
