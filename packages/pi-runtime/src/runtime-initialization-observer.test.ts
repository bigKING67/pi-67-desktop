import { describe, expect, it, vi } from "vitest";
import type { RuntimeInitializationObservation } from "./agent-runtime.js";
import { runRuntimeInitializationStage } from "./runtime-initialization-observer.js";

describe("runtime initialization observer", () => {
  it("reports structured completed timing without exposing initialization inputs", async () => {
    const observations: RuntimeInitializationObservation[] = [];
    const ticks = [10, 35];

    await expect(runRuntimeInitializationStage(
      (observation) => observations.push(observation),
      "create-session",
      async () => "ready",
      () => ticks.shift() ?? 35
    )).resolves.toBe("ready");

    expect(observations).toEqual([
      { stage: "create-session", outcome: "started", durationMs: 0 },
      { stage: "create-session", outcome: "completed", durationMs: 25 }
    ]);
  });

  it("reports a failed outcome and never lets observer failures replace the Runtime error", async () => {
    const observer = vi.fn<(observation: RuntimeInitializationObservation) => void>(() => {
      throw new Error("observer failure");
    });
    const runtimeFailure = new Error("runtime failure");

    await expect(runRuntimeInitializationStage(
      observer,
      "reload-configuration",
      async () => { throw runtimeFailure; },
      () => 10
    )).rejects.toBe(runtimeFailure);
    expect(observer).toHaveBeenCalledTimes(2);
    expect(observer.mock.calls.map(([observation]) => observation.outcome)).toEqual(["started", "failed"]);
  });
});
