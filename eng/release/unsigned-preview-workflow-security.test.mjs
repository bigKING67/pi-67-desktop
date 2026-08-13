import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractWorkflowRunBodies } from "../quality/workflow-source-security.mjs";

const candidateUrl = new URL("../../.github/workflows/windows-candidate.yml", import.meta.url);
const promotionUrl = new URL("../../.github/workflows/unsigned-preview.yml", import.meta.url);

describe("unsigned preview candidate and promotion workflow security", () => {
  it("never interpolates workflow inputs into shell source", async () => {
    for (const url of [candidateUrl, promotionUrl]) {
      const source = await readFile(url, "utf8");
      for (const body of extractWorkflowRunBodies(source)) {
        expect(body).not.toContain("${{ inputs.");
        expect(body).not.toContain("${{ github.event.inputs.");
      }
    }
  });

  it("keeps candidate builds read-only and non-publishing", async () => {
    const source = await readFile(candidateUrl, "utf8");
    expect(source).toContain("name: Windows candidate");
    expect(source).toContain("workflow_dispatch:");
    expect(source).toContain("permissions:\n  contents: read");
    expect(source).not.toContain("contents: write");
    expect(source).not.toContain("gh release create");
    expect(source).toContain("Require an unpublished version identity");
    expect(source).toContain("bump the package version before building a candidate");
    expect(source).toContain("preview-candidate-source.mjs");
    expect(source).toContain("windows-candidate-${{ github.run_id }}-${{ github.run_attempt }}");
  });

  it("preserves bounded installer lifecycle diagnostics when candidate certification fails", async () => {
    const source = await readFile(candidateUrl, "utf8");
    const diagnosticUpload = source.slice(
      source.indexOf("      - name: Upload Windows installer lifecycle diagnostics"),
      source.indexOf("      - name: Upload testable Windows candidate")
    );

    expect(diagnosticUpload).toContain("if: always()");
    expect(diagnosticUpload).toContain("artifacts/validation/windows-installer-lifecycle/");
    expect(diagnosticUpload).toContain("if-no-files-found: warn");
    expect(diagnosticUpload).not.toContain("artifacts/release/");
  });

  it("reuses the candidate build attempt when a failed certification job is rerun", async () => {
    const source = await readFile(candidateUrl, "utf8");
    const build = source.slice(source.indexOf("  build-windows:"), source.indexOf("  certify-installer:"));
    const reverify = source.slice(
      source.indexOf("      - name: Reverify exact Windows candidate bytes"),
      source.indexOf("      - name: Verify full Windows NSIS installer lifecycle")
    );

    expect(build).toContain("candidate_run_attempt: ${{ steps.names.outputs.attempt }}");
    expect(build).toContain('echo "attempt=${GITHUB_RUN_ATTEMPT}" >> "$GITHUB_OUTPUT"');
    expect(reverify).toContain(
      "CANDIDATE_BUILD_ATTEMPT: ${{ needs.build-windows.outputs.candidate_run_attempt }}"
    );
    expect(reverify).toContain("--expected-run-attempt $env:CANDIDATE_BUILD_ATTEMPT");
    expect(reverify).not.toContain("--expected-run-attempt $env:GITHUB_RUN_ATTEMPT");
  });

  it("requires explicit manual test confirmation and publishes only a verified bundle", async () => {
    const source = await readFile(promotionUrl, "utf8");
    expect(source).toContain("confirm_windows_tested:");
    expect(source).toContain("confirm_publish:");
    expect(source).toContain("windows-preview-manual-test.json");
    expect(source).toContain("verified-unsigned-preview-${{ github.run_id }}-${{ github.run_attempt }}");
    expect(source).not.toContain("build-windows:");
    const publish = source.slice(source.indexOf("  publish:"));
    expect(publish).toContain("contents: write");
    expect(publish).not.toContain("actions/checkout");
    expect(publish).not.toContain("actions/setup-node");
    expect(publish).not.toContain("corepack pnpm");
    expect(publish).toContain("Verify immutable allowlist and publish exact candidate");
    expect(publish).toContain("gh release create \"$RELEASE_TAG\"");
  });
});
