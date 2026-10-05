import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { verifySourceRunJobsMetadata } from "./windows-installer-source-run.mjs";

function splitJobs() {
  return { jobs: [
    { name: "Build / Windows x64", status: "completed", conclusion: "success", steps: [] },
    { name: "Native smoke / Windows x64", status: "completed", conclusion: "success", steps: [] },
    { name: "Windows installer lifecycle / Windows x64", status: "completed", conclusion: "failure", steps: [
      { name: "Verify and restore Windows installer transport", number: 9, conclusion: "success" },
      { name: "Verify Windows NSIS installer lifecycle", number: 10, conclusion: "failure" }
    ] }
  ] };
}

it("admits a split failed installer only after both build and native smoke succeeded", () => {
  expect(() => verifySourceRunJobsMetadata(splitJobs())).not.toThrow();
});
it.each(["failure", "skipped", "cancelled", ""])("rejects incomplete split prerequisites: %s", conclusion => {
  for (const index of [0, 1]) {
    const data = splitJobs(); data.jobs[index].conclusion = conclusion;
    expect(() => verifySourceRunJobsMetadata(data)).toThrow("Split Windows prerequisite");
  }
});
it("rejects missing/duplicate split jobs and a failed restore before installer execution", () => {
  const missing = splitJobs(); missing.jobs.splice(1, 1);
  expect(() => verifySourceRunJobsMetadata(missing)).toThrow("Split Windows prerequisite");
  const duplicate = splitJobs(); duplicate.jobs.push(duplicate.jobs[0]);
  expect(() => verifySourceRunJobsMetadata(duplicate)).toThrow("Split Windows prerequisite");
  const invalid = splitJobs(); invalid.jobs[2].steps[0].conclusion = "failure";
  expect(() => verifySourceRunJobsMetadata(invalid)).toThrow("prerequisite did not succeed");
});

it("builds once, runs isolated consumers concurrently, and requires all three results", async () => {
  const text = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const job = name => text.split(`\n  ${name}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/u)[0];
  const build = job("windows-build");
  expect(build).toContain("pnpm run build\n");
  expect(build).toContain("--prepared-resources --ci-fast");
  expect(build).toContain("Verify Windows recovery process ownership");
  for (const [name, kind] of [["native-windows", "runtime"], ["windows-installer", "installer"]]) {
    const consumer = job(name);
    expect(consumer).toContain("needs: [change-scope, windows-build]");
    expect(consumer).toContain("if: ${{ !cancelled() && needs.windows-build.result == 'success' }}");
    expect(consumer).toContain("artifact-ids: ${{ needs.windows-build.outputs." + kind + "-artifact-id }}");
    expect(consumer).toContain(`needs.windows-build.outputs.${kind}-identity`);
    expect(consumer).toContain(`windows-ci-artifact.mjs restore ${kind}`);
    expect(consumer).not.toContain("pnpm run build\n");
    expect(consumer).not.toContain("package-native-unsigned.mjs");
    expect(consumer).not.toContain("continue-on-error:");
  }
  expect(job("native-windows")).not.toContain("Verify Windows NSIS installer lifecycle");
  const installer = job("windows-installer");
  expect(installer).toContain("--quick");
  expect(installer).toContain("needs.change-scope.outputs.windows_installer_mode");
  expect(installer).toContain("DISPATCH_WINDOWS_INSTALLER_MODE");
  expect(installer).toContain("if: ${{ !cancelled() && steps.native-package.outcome == 'success' }}");
  const gate = job("ci-gate");
  for (const name of ["windows-build", "native-windows", "windows-installer"]) {
    expect(gate).toContain(`needs.${name}.result`);
  }
});
