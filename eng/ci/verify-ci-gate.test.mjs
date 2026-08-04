import { describe, expect, it } from "vitest";
import { verifyCiGateResults } from "./verify-ci-gate.mjs";

describe("CI aggregate gate", () => {
  it("accepts successful required jobs and skipped unselected jobs", () => {
    expect(() => verifyCiGateResults({
      scopeResult: "success",
      runQuality: "true",
      qualityResult: "success",
      runWindows: "true",
      windowsResult: "success",
      runMacos: "false",
      macosResult: "skipped",
      reuseWindowsInstaller: "false",
      reuseAvailable: "",
      windowsReuseResult: "skipped"
    })).not.toThrow();
  });

  it("accepts a documentation-only scope", () => {
    expect(() => verifyCiGateResults({
      scopeResult: "success",
      runQuality: "false",
      qualityResult: "skipped",
      runWindows: "false",
      windowsResult: "skipped",
      runMacos: "false",
      macosResult: "skipped",
      reuseWindowsInstaller: "false",
      reuseAvailable: "",
      windowsReuseResult: "skipped"
    })).not.toThrow();
  });

  it("accepts a successfully reused Windows installer candidate", () => {
    expect(() => verifyCiGateResults({
      scopeResult: "success",
      runQuality: "false",
      qualityResult: "skipped",
      runWindows: "false",
      windowsResult: "skipped",
      runMacos: "false",
      macosResult: "skipped",
      reuseWindowsInstaller: "true",
      reuseAvailable: "true",
      windowsReuseResult: "success"
    })).not.toThrow();
  });

  it("requires full quality and Windows validation when reuse is unavailable", () => {
    expect(() => verifyCiGateResults({
      scopeResult: "success",
      runQuality: "false",
      qualityResult: "success",
      runWindows: "false",
      windowsResult: "success",
      runMacos: "false",
      macosResult: "skipped",
      reuseWindowsInstaller: "true",
      reuseAvailable: "false",
      windowsReuseResult: "skipped"
    })).not.toThrow();
  });

  it.each([
    ["scope failure", { scopeResult: "failure" }],
    ["required failure", { windowsResult: "failure" }],
    ["unexpected skip", { windowsResult: "skipped" }],
    ["unexpected execution", { runMacos: "false", macosResult: "success" }]
  ])("rejects %s", (_label, patch) => {
    expect(() => verifyCiGateResults({
      scopeResult: "success",
      runQuality: "true",
      qualityResult: "success",
      runWindows: "true",
      windowsResult: "success",
      runMacos: "true",
      macosResult: "success",
      reuseWindowsInstaller: "false",
      reuseAvailable: "",
      windowsReuseResult: "skipped",
      ...patch
    })).toThrow();
  });
});
