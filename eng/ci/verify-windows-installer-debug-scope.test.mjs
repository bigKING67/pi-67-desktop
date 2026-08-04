import { describe, expect, it } from "vitest";
import {
  verifySourceRunMetadata,
  verifyWindowsInstallerDebugScope
} from "./verify-windows-installer-debug-scope.mjs";

describe("Windows installer debug artifact reuse", () => {
  it("accepts only verifier, lifecycle fixture, and documentation changes", () => {
    expect(() => verifyWindowsInstallerDebugScope([
      "eng/packaging/verify-windows-installer-lifecycle.mjs",
      "eng/packaging/windows-installed-application-lifecycle.mjs",
      "eng/packaging/controlled-shutdown-fixture.ts",
      "docs/testing/windows-installer.md"
    ])).not.toThrow();
  });

  it.each([
    "apps/renderer/src/App.tsx",
    "packages/pi-runtime/src/pi-sdk-runtime.ts",
    "package.json",
    "electron-builder.yml",
    ".github/workflows/windows-installer-debug.yml"
  ])("rejects product or workflow changes: %s", (path) => {
    expect(() => verifyWindowsInstallerDebugScope([path])).toThrow(/artifact reuse rejected/u);
  });

  it("binds artifact reuse to the exact failed CI source run", () => {
    const sourceSha = "a".repeat(40);
    expect(() => verifySourceRunMetadata({
      head_sha: sourceSha,
      status: "completed",
      conclusion: "failure",
      path: ".github/workflows/ci.yml"
    }, sourceSha)).not.toThrow();
    expect(() => verifySourceRunMetadata({
      head_sha: "b".repeat(40),
      status: "completed",
      conclusion: "failure",
      path: ".github/workflows/ci.yml"
    }, sourceSha)).toThrow(/not a completed failed CI run/u);
  });
});
