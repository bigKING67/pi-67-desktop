import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractWorkflowRunBodies } from "../quality/workflow-source-security.mjs";

const workflowUrl = new URL("../../.github/workflows/provider-long-turn-certification.yml", import.meta.url);

describe("Provider certification workflow security", () => {
  it("never interpolates workflow inputs into shell source", async () => {
    const source = await readFile(workflowUrl, "utf8");
    const runBodies = extractWorkflowRunBodies(source);

    expect(runBodies.length).toBeGreaterThan(0);
    for (const body of runBodies) {
      expect(body).not.toContain("${{ inputs.");
      expect(body).not.toContain("${{ github.event.inputs.");
      expect(body).not.toContain("${{ steps.");
    }
  });

  it("requires protected-environment approval and removes checkout credentials", async () => {
    const source = await readFile(workflowUrl, "utf8");

    expect(source).toContain("environment: provider-certification");
    expect(source).toContain("persist-credentials: false");
    expect(source).toContain("Create and verify shared Windows signed candidate identity");
    expect(source).toContain("Revalidate certified candidate bytes and signer");
    expect(source).toContain("release:candidate:identity");
    expect(source).toContain("release:candidate:verify");
    expect(source).toContain("$sourcePolicy = if ($packageVersion.Contains('-'))");
    expect(source).toContain("--source-policy $sourcePolicy");
    expect(source).toContain("--expected-source-policy $sourcePolicy");
    expect(source).toContain("$field.Value -ne $field.Value.Trim()");
    expect(source).toContain("$field.Value -match '[\\x00-\\x1F\\x7F]'");
    expect(source).toContain("must be a canonical bounded single-line value");
    expect(source).toContain("PI67_REAL_PROVIDER_CANDIDATE_SOURCE_POLICY");
    expect(source).toContain("--expected-source-policy $env:SOURCE_POLICY");
    expect(source).toContain("windows-signed-candidate-identity.json");
    expect(source).not.toContain("pi67.provider-certification-artifact.v1");
    expect(source).not.toContain("artifact-identity.json");
    expect(source).toContain(
      "provider-long-turn-windows-x64-${{ github.run_id }}-${{ github.run_attempt }}"
    );
  });
});
