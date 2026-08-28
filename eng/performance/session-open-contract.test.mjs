import { describe, expect, it } from "vitest";
import {
  SESSION_OPEN_PROFILES,
  resolveSessionOpenProfile,
  resolveSessionOpenSampleCount
} from "./session-open-contract.mjs";

describe("Session open performance workload contract", () => {
  it("keeps ordinary measurement bounded while retaining an explicit 500 MiB profile", () => {
    expect(SESSION_OPEN_PROFILES.standard.workloads.map((workload) => workload.id))
      .toEqual(["10MiB", "100MiB"]);
    expect(SESSION_OPEN_PROFILES.extended.workloads.map((workload) => workload.id))
      .toEqual(["10MiB", "100MiB", "500MiB"]);
  });

  it("uses one sample by default for the extended profile", () => {
    expect(resolveSessionOpenSampleCount(resolveSessionOpenProfile("extended"))).toBe(1);
  });

  it("rejects unknown profiles", () => {
    expect(() => resolveSessionOpenProfile("all-user-sessions")).toThrow(
      "PI67_PERF_SESSION_OPEN_PROFILE must be standard or extended."
    );
  });
});
