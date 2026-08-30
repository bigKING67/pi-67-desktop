import { describe, expect, it } from "vitest";
import { BoundedDiagnosticEvidence } from "./diagnostic-evidence.js";

describe("BoundedDiagnosticEvidence", () => {
  it("keeps the newest entries and reports bounded truncation", () => {
    const evidence = new BoundedDiagnosticEvidence<{ sequence: number }>(2);
    evidence.record({ sequence: 1 });
    evidence.record({ sequence: 2 });
    evidence.record({ sequence: 3 });

    const snapshot = evidence.snapshot((entry) => ({ ...entry }));
    expect(snapshot).toEqual({
      entries: [{ sequence: 2 }, { sequence: 3 }],
      droppedCount: 1
    });

    snapshot.entries[0]!.sequence = 99;
    expect(evidence.snapshot((entry) => ({ ...entry })).entries[0]?.sequence).toBe(2);
  });

  it("rejects unbounded capacities", () => {
    expect(() => new BoundedDiagnosticEvidence(0)).toThrow(RangeError);
    expect(() => new BoundedDiagnosticEvidence(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
