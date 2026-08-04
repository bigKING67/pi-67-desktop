import { describe, expect, it } from "vitest";
import { classifyChangedPaths, normalizeRepoPath } from "./classify-change-scope.mjs";

describe("CI change scope classifier", () => {
  it("skips product validation for documentation-only changes", () => {
    expect(classifyChangedPaths(["README.md", "docs/testing/ci.md"])).toMatchObject({
      reason: "docs-only",
      runQuality: false,
      runWindows: false,
      runMacos: false,
      fullValidation: false
    });
  });

  it("runs only Windows native validation for installer verifier changes", () => {
    expect(classifyChangedPaths([
      "eng/packaging/verify-windows-installer-lifecycle.mjs",
      "eng/packaging/windows-installed-application-lifecycle.mjs",
      "eng/packaging/controlled-shutdown-fixture.test.mjs"
    ])).toMatchObject({
      reason: "windows-only",
      runQuality: true,
      runWindows: true,
      runMacos: false,
      fullValidation: false
    });
  });

  it("runs only macOS native validation for macOS packaging changes", () => {
    expect(classifyChangedPaths([
      "eng/packaging/preview-macos-unsigned.mjs",
      "eng/packaging/entitlements.mac.plist"
    ])).toMatchObject({
      reason: "macos-only",
      runQuality: true,
      runWindows: false,
      runMacos: true,
      fullValidation: false
    });
  });

  it.each([
    ["shared renderer", ["apps/renderer/src/App.tsx"]],
    ["runtime package", ["packages/pi-runtime/src/pi-sdk-runtime.ts"]],
    ["dependency lock", ["pnpm-lock.yaml"]],
    ["workflow source", [".github/workflows/ci.yml"]],
    ["mixed native platforms", [
      "eng/packaging/verify-windows-installer-lifecycle.mjs",
      "eng/packaging/preview-macos-unsigned.mjs"
    ]]
  ])("fails safe to both native platforms for %s", (_label, paths) => {
    expect(classifyChangedPaths(paths)).toMatchObject({
      runQuality: true,
      runWindows: true,
      runMacos: true,
      fullValidation: true
    });
  });

  it("fails safe when the resolved diff is empty", () => {
    expect(classifyChangedPaths([])).toMatchObject({
      reason: "empty-diff",
      runQuality: true,
      runWindows: true,
      runMacos: true,
      fullValidation: true
    });
  });

  it("normalizes checkout paths before classification", () => {
    expect(normalizeRepoPath(".\\eng\\packaging\\windows-installer-identity.mjs"))
      .toBe("eng/packaging/windows-installer-identity.mjs");
  });
});
