import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractWorkflowRunBodies } from "../quality/workflow-source-security.mjs";

const workflowUrl = new URL("../../.github/workflows/release.yml", import.meta.url);

async function readWorkflowSource() {
  return (await readFile(workflowUrl, "utf8")).replace(/\r\n?/gu, "\n");
}

describe("signed release workflow security", () => {
  it("never interpolates workflow inputs into shell source", async () => {
    const source = await readWorkflowSource();
    for (const body of extractWorkflowRunBodies(source)) {
      expect(body).not.toContain("${{ inputs.");
      expect(body).not.toContain("${{ github.event.inputs.");
    }
  });

  it("protects signing and publishing authority", async () => {
    const source = await readWorkflowSource();

    expect(source.match(/environment: production-release/gu)).toHaveLength(2);
    expect(source).toContain("environment: provider-certification");
    expect(source).toContain("environment: windows-native-certification");
    expect(source.match(/persist-credentials: false/gu)).toHaveLength(5);
    expect(source).toContain("WINDOWS_SIGNER_THUMBPRINT");
    expect(source).toContain("repository or organization variable is required");
    expect(source).toContain("MACOS_EXPECTED_TEAM_ID");
    expect(source).toContain("Unexpected Windows Authenticode signer");
    expect(source).toContain("Unexpected macOS TeamIdentifier");
    expect(source).toContain("$field.Value -ne $field.Value.Trim()");
    expect(source).toContain("$field.Value -match '[\\x00-\\x1F\\x7F]'");
    expect(source).toContain("must be a canonical bounded single-line value");
    expect(source).toContain(
      "extension-adapter-provenance-signed-release-${{ github.run_id }}-${{ github.run_attempt }}"
    );
    expect(source).toContain(
      "windows-packaged-ui-signed-release-x64-${{ github.run_id }}-${{ github.run_attempt }}"
    );
    expect(source).toContain(
      "windows-installer-lifecycle-signed-release-x64-${{ github.run_id }}-${{ github.run_attempt }}"
    );
  });

  it("automatically binds Windows upgrade verification to the direct previous stable release", async () => {
    const source = await readWorkflowSource();

    expect(source).not.toContain("previous_tag:\n");
    expect(source).toContain("release:stable-tag:verify");
    expect(source).toContain("group: signed-release-${{ inputs.tag }}");
    expect(source).toContain("Resolve direct previous stable release");
    expect(source).toContain("release:baseline:resolve");
    expect(source).toContain("needs.provenance.outputs.first_signed_release != 'true'");
    expect(source).toContain("PI67_BASELINE_MANIFEST_ASSET_ID");
    expect(source).toContain("PI67_BASELINE_INSTALLER_ASSET_ID");
    expect(source).toContain("Accept: application/octet-stream");
    expect(source).toContain("release:baseline:verify");
    expect(source).toContain("release:candidate:identity");
    expect(source).toContain("windows-signed-candidate-identity.json");
  });

  it("makes real Provider and Windows native certification unavoidable publish dependencies", async () => {
    const source = await readWorkflowSource();

    expect(source).toContain("provider_long_turn_certify:");
    expect(source).toContain("windows_native_certify:");
    expect(source).toContain("verify_release_gate:");
    expect(source).toContain(
      "needs: [provenance, build, provider_long_turn_certify, windows_native_certify]"
    );
    expect(source).toContain("needs: verify_release_gate");
    expect(source).toContain("pi67-native-certification");
    expect(source).toContain("interactive-desktop");
    expect(source).toContain("--interaction-mode workflow");
    expect(source).toContain("--expected-scale 1.25");
    expect(source).toContain("--expected-scale 1.5");
    expect(source).toContain("--expected-scale 2");
    expect(source).toContain("--sleep");
    expect(source).toContain("release:candidate:verify");
    expect(source).toContain("release:provider-long-turn-gate");
    expect(source).toContain("release:windows-native-gate");
    expect(source).toContain(
      "provider-long-turn-certification-${{ github.run_id }}-${{ github.run_attempt }}"
    );
    expect(source).toContain("verified-release-bundle-${{ github.run_id }}-${{ github.run_attempt }}");
    expect(source).toContain("release-windows-x64-${{ github.run_id }}-${{ github.run_attempt }}");
    expect(source).toContain("windows-native-certification-${{ github.run_id }}-${{ github.run_attempt }}");
    expect(source).not.toContain("gh release create \"$RELEASE_TAG\" artifacts/release/*");
    const verifyGate = source.slice(
      source.indexOf("\n  verify_release_gate:\n"),
      source.indexOf("\n  publish:\n")
    );
    expect(verifyGate).not.toContain("environment:");
  });

  it("certifies the exact release-built Windows candidate without exposing signing credentials", async () => {
    const source = await readWorkflowSource();
    const providerJob = source.slice(
      source.indexOf("\n  provider_long_turn_certify:\n"),
      source.indexOf("\n  windows_native_certify:\n")
    );

    expect(providerJob).toContain("environment: provider-certification");
    expect(providerJob).toContain(
      "name: release-windows-x64-${{ github.run_id }}-${{ github.run_attempt }}"
    );
    expect(providerJob).toContain("path: artifacts/release");
    expect(providerJob).toContain("artifacts/release/win-unpacked/Pi-67 Desktop.exe");
    expect(providerJob).toContain("PI67_REAL_PROVIDER_CANDIDATE_SOURCE_POLICY: stable");
    expect(providerJob).toContain(
      '"PI67_REAL_PROVIDER_SOURCE_COMMIT=$commit" >> $env:GITHUB_ENV'
    );
    expect(providerJob).toContain(
      "--expected-source-commit $env:PI67_REAL_PROVIDER_SOURCE_COMMIT"
    );
    expect(providerJob).toContain(
      "PI67_REAL_PROVIDER_OUTPUT: artifacts/validation/provider-long-turn/summary.json"
    );
    expect(providerJob).toContain(
      "path: artifacts/validation/provider-long-turn/summary.json"
    );
    expect(providerJob).toContain("release:candidate:verify");
    expect(providerJob).not.toContain("package:win");
    expect(providerJob).not.toContain("WINDOWS_CSC_LINK");
    expect(providerJob).not.toContain("WINDOWS_CSC_KEY_PASSWORD");

    const verifyGate = source.slice(
      source.indexOf("\n  verify_release_gate:\n"),
      source.indexOf("\n  publish:\n")
    );
    expect(verifyGate).toContain(
      "name: provider-long-turn-certification-${{ github.run_id }}-${{ github.run_attempt }}"
    );
    expect(verifyGate).toContain("path: artifacts/certification/provider-long-turn");
    expect(verifyGate).toContain(
      "--summary artifacts/certification/provider-long-turn/summary.json"
    );
  });

  it("bounds native installer Registry cleanup to new exact InstallLocation entries", async () => {
    const source = await readWorkflowSource();
    const nativeJob = source.slice(
      source.indexOf("\n  windows_native_certify:\n"),
      source.indexOf("\n  verify_release_gate:\n")
    );
    const installStep = nativeJob.slice(
      nativeJob.indexOf("- name: Verify and install exact signed Windows candidate"),
      nativeJob.indexOf("- name: Certify Windows native runtime at 125 percent")
    );
    const cleanupStep = nativeJob.slice(
      nativeJob.indexOf("- name: Uninstall and clean isolated Windows native candidate")
    );

    const pathBindingStep = nativeJob.slice(
      nativeJob.indexOf("- name: Bind isolated Windows native paths"),
      nativeJob.search(/- uses: actions\/checkout@[0-9a-f]{40} # v5/u)
    );
    expect(pathBindingStep).toContain('$installLeaf = "pi67-native-install-{0}-{1}" -f');
    expect(pathBindingStep).toContain('$env:GITHUB_RUN_ID, $env:GITHUB_RUN_ATTEMPT');
    expect(pathBindingStep).toContain('$registryGuardLeaf = "{0}-uninstall-registry.json" -f $installLeaf');
    expect(pathBindingStep).toContain("$installRoot = Join-Path $env:RUNNER_TEMP $installLeaf");
    expect(pathBindingStep).toContain(
      "$registryGuardState = Join-Path $env:RUNNER_TEMP $registryGuardLeaf"
    );
    expect(pathBindingStep).toContain("PI67_WINDOWS_NATIVE_INSTALL_ROOT=$installRoot");
    expect(pathBindingStep).toContain("PI67_WINDOWS_NATIVE_REGISTRY_GUARD_STATE=$registryGuardState");
    expect(pathBindingStep).toContain("-FilePath $env:GITHUB_ENV");
    expect(nativeJob.slice(0, nativeJob.indexOf("\n    steps:\n"))).not.toContain("${{ runner.temp }}");
    expect(installStep).toContain("windows-uninstall-registry-guard.ps1");
    expect(installStep.indexOf("-Action Snapshot")).toBeLessThan(installStep.indexOf("Start-Process"));
    expect(installStep.indexOf("Windows candidate installer exited with code"))
      .toBeLessThan(installStep.indexOf("-Action Observe"));
    expect(cleanupStep).toContain("if: always()");
    expect(cleanupStep).toContain("-Action Cleanup");
    expect(cleanupStep).toContain("$cleanupErrors.Add($_.Exception.Message)");
    expect(cleanupStep.indexOf("Remove-Item -LiteralPath $installRoot"))
      .toBeLessThan(cleanupStep.indexOf("-Action Cleanup"));
    expect(cleanupStep).not.toContain("DisplayName");
    expect(cleanupStep).not.toContain("Get-ChildItem HK");
  });

  it("keeps the contents-write publish job free of checked-out repository code", async () => {
    const source = await readWorkflowSource();
    const publish = source.slice(source.indexOf("\n  publish:\n"));

    expect(publish).not.toContain("actions/checkout");
    expect(publish).not.toContain("pnpm/action-setup");
    expect(publish).not.toContain("actions/setup-node");
    expect(publish).not.toContain("corepack pnpm");
    expect(publish).toContain("Download verified release bundle");
    expect(publish).toContain("Verify immutable publish allowlist");
    expect(publish).toContain("provider-long-turn-release-gate.json");
    expect(publish).toContain("provider-long-turn-summary.json");
    expect(publish).toContain("windows-native-scale-200-workspace.png");
  });
});
