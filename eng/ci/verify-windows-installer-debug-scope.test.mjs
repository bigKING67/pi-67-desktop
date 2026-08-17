import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  verifySourceRunJobsMetadata,
  verifySourceRunMetadata,
  verifyWindowsInstallerDebugScope
} from "./verify-windows-installer-debug-scope.mjs";
import {
  WINDOWS_INSTALLER_LIFECYCLE_STEP_NAME,
  WINDOWS_NATIVE_JOB_NAME,
  WINDOWS_PACKAGED_UI_STEP_NAME
} from "./windows-installer-source-run.mjs";

describe("Windows installer debug artifact reuse", () => {
  it("accepts only verifier, verifier workflows, lifecycle fixtures, and documentation changes", () => {
    expect(() => verifyWindowsInstallerDebugScope([
      "eng/packaging/verify-windows-installer-lifecycle.mjs",
      "eng/packaging/windows-installed-application-lifecycle.mjs",
      "eng/packaging/windows-installed-application-lifecycle.test.mjs",
      "eng/packaging/windows-installer-process.mjs",
      "eng/packaging/windows-installer-lifecycle-contract.mjs",
      "eng/packaging/windows-real-user-lifecycle.mjs",
      "eng/packaging/windows-real-user-lifecycle.test.mjs",
      "eng/packaging/windows-real-user-catalog-discovery.mjs",
      "eng/packaging/windows-real-user-catalog-discovery.test.mjs",
      "eng/packaging/windows-real-user-catalog-state.mjs",
      "eng/packaging/windows-real-user-conversation.mjs",
      "eng/packaging/windows-real-user-profile.mjs",
      "eng/packaging/windows-real-user-profile.test.mjs",
      "eng/packaging/windows-real-user-session-creation.mjs",
      "eng/packaging/windows-real-user-session-creation.test.mjs",
      "eng/packaging/windows-installer-profile-authority.test.mjs",
      "eng/packaging/verify-windows-packaged-input-layout.mjs",
      "eng/packaging/verify-windows-packaged-input-layout.test.mjs",
      "eng/packaging/windows-layout-observation.mjs",
      "eng/packaging/controlled-shutdown-fixture.ts",
      "eng/ci/windows-installer-source-run.mjs",
      "eng/ci/classify-change-scope.test.mjs",
      "eng/ci/verify-windows-installer-debug-scope.mjs",
      "eng/ci/verify-windows-installer-debug-scope.test.mjs",
      "eng/ci/windows-installer-verifier-scope.mjs",
      ".github/workflows/windows-installer-debug.yml",
      ".github/workflows/windows-candidate.yml",
      ".github/workflows/release.yml",
      "docs/testing/windows-installer.md"
    ])).not.toThrow();
  });

  it.each([
    "apps/renderer/src/App.tsx",
    "packages/pi-runtime/src/pi-sdk-runtime.ts",
    "package.json",
    "electron-builder.yml",
    ".github/workflows/ci.yml"
  ])("rejects product or workflow changes: %s", (path) => {
    expect(() => verifyWindowsInstallerDebugScope([path])).toThrow(/artifact reuse rejected/u);
  });

  it("binds artifact reuse to the exact failed CI source run", () => {
    const sourceSha = "a".repeat(40);
    expect(() => verifySourceRunMetadata({
      head_sha: sourceSha,
      status: "completed",
      conclusion: "failure",
      path: ".github/workflows/ci.yml",
      run_attempt: 1
    }, sourceSha)).not.toThrow();
    expect(() => verifySourceRunMetadata({
      head_sha: "b".repeat(40),
      status: "completed",
      conclusion: "failure",
      path: ".github/workflows/ci.yml",
      run_attempt: 1
    }, sourceSha)).toThrow(/not a completed failed CI run/u);
  });

  it("requires the source Windows job to fail only after installer prerequisites pass", () => {
    const metadata = {
      jobs: [{
        name: WINDOWS_NATIVE_JOB_NAME,
        status: "completed",
        conclusion: "failure",
        steps: [
          { number: 12, name: WINDOWS_PACKAGED_UI_STEP_NAME, conclusion: "success" },
          { number: 13, name: WINDOWS_INSTALLER_LIFECYCLE_STEP_NAME, conclusion: "failure" }
        ]
      }]
    };
    expect(() => verifySourceRunJobsMetadata(metadata)).not.toThrow();
    const packagedUiFailure = {
      jobs: [{
        ...metadata.jobs[0],
        steps: [
          { number: 12, name: WINDOWS_PACKAGED_UI_STEP_NAME, conclusion: "failure" },
          { number: 13, name: WINDOWS_INSTALLER_LIFECYCLE_STEP_NAME, conclusion: "skipped" }
        ]
      }]
    };
    expect(() => verifySourceRunJobsMetadata(packagedUiFailure))
      .toThrow(/did not fail at the installer lifecycle step/u);
    expect(() => verifySourceRunJobsMetadata(packagedUiFailure, { allowPackagedUiFailure: true }))
      .not.toThrow();
  });

  it("builds workspace dependencies before running the direct Node verifier", async () => {
    const workflow = await readFile(new URL("../../.github/workflows/windows-installer-debug.yml", import.meta.url), "utf8");
    const buildStep = workflow.indexOf("- name: Build verifier workspace dependencies");
    const lifecycleStep = workflow.indexOf("- name: Verify Windows NSIS installer lifecycle");

    expect(buildStep).toBeGreaterThan(-1);
    expect(lifecycleStep).toBeGreaterThan(buildStep);
    expect(workflow.slice(buildStep, lifecycleStep))
      .toContain("pnpm run build:packages");
    expect(workflow).toContain("run: pnpm run package:smoke:windows-installer");
    expect(workflow).not.toContain("package:smoke:windows-installer -- --quick");
  });

  it("exposes the verifier as a reusable workflow and rechecks source job metadata", async () => {
    const workflow = await readFile(new URL("../../.github/workflows/windows-installer-debug.yml", import.meta.url), "utf8");
    expect(workflow).toMatch(/workflow_call:[\s\S]*?source_run_id:/u);
    expect(workflow).toContain("source-run-jobs.json");
    expect(workflow).toContain("--jobs-metadata $jobsMetadata");
    expect(workflow).toContain("eng/ci/verify-windows-installer-debug-scope.test.mjs");
    expect(workflow).toContain("eng/packaging/windows-artifact-identity.test.mjs");
  });

  it("uses the pnpm 11 native setup action for CI and installer reuse", async () => {
    const workflows = await Promise.all([
      readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"),
      readFile(new URL("../../.github/workflows/windows-installer-debug.yml", import.meta.url), "utf8")
    ]);

    for (const workflow of workflows) {
      const installStep = workflow.indexOf("- name: Install frozen dependencies");
      const pnpmRuntimeStep = workflow.indexOf("- name: Verify pnpm execution runtime");

      expect(workflow).toMatch(/uses: pnpm\/setup@[0-9a-f]{40} # v1/u);
      expect(workflow).toContain("runtime: node@24.18.0");
      expect(workflow).toContain("cache: false");
      expect(workflow).toContain("install: false");
      expect(workflow).toContain("pnpm exec node -e");
      expect(workflow).toContain('test "$(pnpm --version)" = "11.16.0"');
      expect(installStep).toBeGreaterThan(-1);
      expect(pnpmRuntimeStep).toBeGreaterThan(installStep);
      expect(workflow).not.toContain("pnpm/action-setup");
      expect(workflow).not.toContain("actions/setup-node");
      expect(workflow).not.toContain("corepack pnpm");
    }
  });

  it("routes automatic reuse through the reusable verifier with full fallback", async () => {
    const workflow = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
    expect(workflow).toContain("node eng/ci/resolve-windows-installer-reuse.mjs");
    expect(workflow).toContain("uses: ./.github/workflows/windows-installer-debug.yml");
    expect(workflow).toMatch(/quality-gates:[\s\S]*?reuse_windows_installer_available != 'true'/u);
    expect(workflow).toMatch(/renderer-e2e:[\s\S]*?reuse_windows_installer_available != 'true'/u);
    expect(workflow).toMatch(/native-windows:[\s\S]*?reuse_windows_installer_available != 'true'/u);
    expect(workflow).toContain("windows-installer-reuse]");
  });
});
