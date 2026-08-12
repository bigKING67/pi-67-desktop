import { describe, expect, it } from "vitest";
import { classifyChangedPaths, normalizeRepoPath } from "./classify-change-scope.mjs";

describe("CI change scope classifier", () => {
  it("skips product validation for documentation-only changes", () => {
    expect(classifyChangedPaths(["README.md", "docs/testing/ci.md"])).toMatchObject({
      reason: "docs-only",
      runQuality: false,
      runWindows: false,
      runMacos: false,
      windowsInstallerMode: "none",
      fullValidation: false
    });
  });

  it("runs only quality validation for Renderer browser spec changes", () => {
    expect(classifyChangedPaths([
      "docs/testing/ci.md",
      "tests/e2e/renderer-appearance.spec.ts",
      "tests/e2e/renderer.spec.ts"
    ])).toMatchObject({
      reason: "quality-only",
      runQuality: true,
      runWindows: false,
      runMacos: false,
      windowsInstallerMode: "none",
      fullValidation: false,
      reuseWindowsInstaller: false
    });
  });

  it("keeps native Electron specs on fail-safe full validation", () => {
    expect(classifyChangedPaths(["tests/e2e/electron.spec.ts"])).toMatchObject({
      reason: "shared-or-unknown",
      runQuality: true,
      runWindows: true,
      runMacos: true,
      fullValidation: true
    });
  });

  it("selects artifact reuse for installer verifier-only changes", () => {
    expect(classifyChangedPaths([
      "eng/packaging/verify-windows-installer-lifecycle.mjs",
      "eng/packaging/windows-installed-application-lifecycle.mjs",
      "eng/packaging/windows-installed-application-lifecycle.test.mjs",
      "eng/packaging/windows-installer-process.mjs",
      "eng/packaging/windows-installer-lifecycle-contract.mjs",
      "eng/packaging/windows-real-user-lifecycle.mjs",
      "eng/packaging/windows-real-user-lifecycle.test.mjs",
      "eng/packaging/windows-real-user-catalog-state.mjs",
      "eng/packaging/windows-real-user-conversation.mjs",
      "eng/packaging/windows-real-user-profile.mjs",
      "eng/packaging/windows-real-user-profile.test.mjs",
      "eng/packaging/windows-real-user-session-creation.mjs",
      "eng/packaging/windows-real-user-session-creation.test.mjs",
      "eng/packaging/windows-installer-profile-authority.test.mjs",
      "eng/packaging/controlled-shutdown-fixture.test.mjs",
      "eng/packaging/verify-windows-packaged-input-layout.mjs",
      "eng/packaging/windows-layout-observation.mjs",
      "eng/ci/windows-installer-source-run.mjs",
      "eng/ci/verify-windows-installer-debug-scope.mjs",
      "eng/ci/windows-installer-verifier-scope.mjs"
    ])).toMatchObject({
      reason: "windows-installer-verifier-only",
      runQuality: false,
      runWindows: false,
      runMacos: false,
      fullValidation: false,
      windowsInstallerMode: "full",
      reuseWindowsInstaller: true
    });
  });

  it("keeps documentation changes compatible with installer verifier reuse", () => {
    expect(classifyChangedPaths([
      "docs/testing/ci.md",
      "eng/packaging/verify-windows-installer-lifecycle.test.mjs"
    ])).toMatchObject({
      reason: "windows-installer-verifier-only",
      reuseWindowsInstaller: true
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
      windowsInstallerMode: "none",
      fullValidation: false,
      reuseWindowsInstaller: false
    });
  });

  it.each([
    ["shared renderer", ["apps/renderer/src/App.tsx"], "quick"],
    ["runtime package", ["packages/pi-runtime/src/pi-sdk-runtime.ts"], "quick"],
    ["dependency lock", ["pnpm-lock.yaml"], "full"],
    ["workflow source", [".github/workflows/ci.yml"], "quick"],
    ["mixed native platforms", [
      "eng/packaging/verify-windows-installer-lifecycle.mjs",
      "eng/packaging/preview-macos-unsigned.mjs"
    ], "full"]
  ])("fails safe to both native platforms for %s", (_label, paths, windowsInstallerMode) => {
    expect(classifyChangedPaths(paths)).toMatchObject({
      runQuality: true,
      runWindows: true,
      runMacos: true,
      windowsInstallerMode,
      fullValidation: true,
      reuseWindowsInstaller: false
    });
  });

  it("fails safe when the resolved diff is empty", () => {
    expect(classifyChangedPaths([])).toMatchObject({
      reason: "empty-diff",
      runQuality: true,
      runWindows: true,
      runMacos: true,
      windowsInstallerMode: "full",
      fullValidation: true,
      reuseWindowsInstaller: false
    });
  });

  it("normalizes checkout paths before classification", () => {
    expect(normalizeRepoPath(".\\eng\\packaging\\windows-installer-identity.mjs"))
      .toBe("eng/packaging/windows-installer-identity.mjs");
  });

  it("keeps installer-byte and packaging changes on full lifecycle certification", () => {
    expect(classifyChangedPaths(["electron-builder.yml"])).toMatchObject({
      windowsInstallerMode: "full"
    });
    expect(classifyChangedPaths(["eng/packaging/package-native-unsigned.mjs"])).toMatchObject({
      windowsInstallerMode: "full"
    });
  });
});
