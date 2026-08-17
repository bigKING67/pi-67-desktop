import { describe, expect, it } from "vitest";
import {
  usageWindowEndUtcExclusive,
  usageWindowDatesUtc,
  usageWindowDayCount,
  usageWindowStartUtc
} from "./usage.js";

describe("usage window policy", () => {
  it.each([
    ["7d", 7],
    ["30d", 30],
    ["90d", 90]
  ] as const)("maps %s to %i consecutive UTC dates", (window, days) => {
    expect(usageWindowDayCount(window)).toBe(days);
    expect(usageWindowDatesUtc(Date.UTC(2026, 7, 17, 23, 59), window)).toHaveLength(days);
  });

  it("starts at UTC midnight and includes the generated UTC date", () => {
    const now = Date.UTC(2026, 7, 17, 10, 2);

    expect(usageWindowStartUtc(now, "7d")).toBe(Date.UTC(2026, 7, 11));
    expect(usageWindowEndUtcExclusive(now)).toBe(Date.UTC(2026, 7, 18));
    expect(usageWindowDatesUtc(now, "7d")).toEqual([
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
      "2026-08-17"
    ]);
  });

  it("crosses month and year boundaries without dropping dates", () => {
    expect(usageWindowDatesUtc(Date.UTC(2027, 0, 2, 1), "7d")).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02"
    ]);
  });
});
