import { describe, expect, it, vi } from "vitest";
import { resolveWindowsInstallerReuseSource } from "./resolve-windows-installer-reuse.mjs";
import {
  WINDOWS_INSTALLER_LIFECYCLE_STEP_NAME,
  WINDOWS_NATIVE_JOB_NAME
} from "./windows-installer-source-run.mjs";

const sourceSha = "a".repeat(40);

describe("Windows installer automatic artifact reuse", () => {
  it("selects an exact-SHA failed lifecycle run with a live candidate", async () => {
    const listJobs = vi.fn(async () => lifecycleJobs("failure"));
    const listArtifacts = vi.fn(async (runId) => ({
      42: [{
        name: "windows-installer-debug-candidate-42",
        expired: false,
        size_in_bytes: 353_704_443
      }]
    })[runId] ?? []);

    await expect(resolveWindowsInstallerReuseSource({
      sourceSha,
      runs: [sourceRun(42)],
      listJobs,
      listArtifacts
    })).resolves.toEqual({
      available: true,
      artifactName: "windows-installer-debug-candidate-42",
      reason: "reusable-failed-lifecycle-run",
      sourceRunId: "42",
      sourceSha
    });
    expect(listJobs).toHaveBeenCalledWith(42);
    expect(listArtifacts).toHaveBeenCalledWith(42);
  });

  it("skips unrelated failures and selects the newest valid lifecycle candidate", async () => {
    const listJobs = vi.fn(async (runId) => runId === 44
      ? lifecycleJobs("success", "failure")
      : lifecycleJobs("failure"));
    const listArtifacts = vi.fn(async (runId) => [{
      name: `windows-installer-debug-candidate-${runId}`,
      expired: false,
      size_in_bytes: 1
    }]);

    const result = await resolveWindowsInstallerReuseSource({
      sourceSha,
      runs: [sourceRun(43, "2026-08-04T01:00:00Z"), sourceRun(44, "2026-08-04T02:00:00Z")],
      listJobs,
      listArtifacts
    });

    expect(result.sourceRunId).toBe("43");
  });

  it.each([
    ["expired", { expired: true, size_in_bytes: 1 }],
    ["empty", { expired: false, size_in_bytes: 0 }]
  ])("falls back when the exact candidate is %s", async (_label, artifactPatch) => {
    const result = await resolveWindowsInstallerReuseSource({
      sourceSha,
      runs: [sourceRun(42)],
      listJobs: async () => lifecycleJobs("failure"),
      listArtifacts: async () => [{
        name: "windows-installer-debug-candidate-42",
        ...artifactPatch
      }]
    });

    expect(result).toMatchObject({
      available: false,
      reason: "no-reusable-installer-lifecycle-candidate"
    });
  });

  it("falls back when the source run exposes duplicate live candidate names", async () => {
    const candidate = {
      name: "windows-installer-debug-candidate-42",
      expired: false,
      size_in_bytes: 1
    };
    const result = await resolveWindowsInstallerReuseSource({
      sourceSha,
      runs: [sourceRun(42)],
      listJobs: async () => lifecycleJobs("failure"),
      listArtifacts: async () => [candidate, { ...candidate }]
    });

    expect(result).toMatchObject({
      available: false,
      reason: "no-reusable-installer-lifecycle-candidate"
    });
  });

  it("does not query artifacts when no exact failed CI run exists", async () => {
    const listArtifacts = vi.fn();
    const result = await resolveWindowsInstallerReuseSource({
      sourceSha,
      runs: [sourceRun(42, undefined, { head_sha: "b".repeat(40) })],
      listJobs: vi.fn(),
      listArtifacts
    });

    expect(result).toMatchObject({ available: false, reason: "no-completed-failed-ci-run" });
    expect(listArtifacts).not.toHaveBeenCalled();
  });
});

function sourceRun(id, updatedAt = "2026-08-04T01:00:00Z", patch = {}) {
  return {
    id,
    head_sha: sourceSha,
    status: "completed",
    conclusion: "failure",
    path: ".github/workflows/ci.yml",
    run_attempt: 1,
    updated_at: updatedAt,
    ...patch
  };
}

function lifecycleJobs(lifecycleConclusion, prerequisiteConclusion = "success") {
  return {
    jobs: [{
      name: WINDOWS_NATIVE_JOB_NAME,
      status: "completed",
      conclusion: "failure",
      steps: [
        {
          number: 12,
          name: "Verify Windows packaged synthetic scale and IME contracts",
          status: "completed",
          conclusion: prerequisiteConclusion
        },
        {
          number: 13,
          name: WINDOWS_INSTALLER_LIFECYCLE_STEP_NAME,
          status: "completed",
          conclusion: lifecycleConclusion
        }
      ]
    }]
  };
}
