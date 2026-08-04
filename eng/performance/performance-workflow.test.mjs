import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const performanceWorkflows = [
  ["performance certification", new URL("../../.github/workflows/performance-certification.yml", import.meta.url)],
  ["signed release", new URL("../../.github/workflows/release.yml", import.meta.url)]
];

describe("release performance workflow gates", () => {
  it.each(performanceWorkflows)("enforces the complete performance suite in %s", async (_name, url) => {
    const source = await readFile(url, "utf8");

    expect(source).toContain("PI67_PERF_SAMPLES: 10");
    expect(source).toContain("PI67_PERF_JSONL_BOUNDARY_SAMPLES: 3");
    expect(source).toContain("PI67_PERF_ENFORCE: 1");
    expect(source).toContain("run: corepack pnpm run performance:measure");
    expect(source).toContain("path: artifacts/performance/*.json");
    expect(source).toContain("if-no-files-found: error");
  });

  it("prepares clean-checkout packaging resources before native measurement", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));

    expect(packageJson.scripts["performance:prepare"]).toBe(
      "corepack pnpm run build && corepack pnpm run prepare:toolchain && corepack pnpm run prepare:capabilities && node eng/performance/prepare-packaged-app.mjs"
    );
  });

  it("scopes push validation while preserving native platform evidence", async () => {
    const source = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
    const scopeStart = source.indexOf("  change-scope:");
    const qualityStart = source.indexOf("  quality-gates:");
    const rendererStart = source.indexOf("  renderer-e2e:");
    const windowsStart = source.indexOf("  native-windows:");
    const macosStart = source.indexOf("  native-macos:");
    const gateStart = source.indexOf("  ci-gate:");
    const qualitySource = source.slice(qualityStart, rendererStart);
    const rendererSource = source.slice(rendererStart, windowsStart);
    const windowsSource = source.slice(windowsStart, macosStart);
    const macosSource = source.slice(macosStart, gateStart);

    expect(source).not.toContain("performance:measure");
    expect(source).not.toContain("PI67_PERF_SAMPLES");
    expect(source).toContain("group: ci-${{ github.workflow }}-${{ github.ref }}");
    expect(source).toContain("cancel-in-progress: true");
    expect(scopeStart).toBeGreaterThan(-1);
    expect(qualityStart).toBeGreaterThan(scopeStart);
    expect(rendererStart).toBeGreaterThan(qualityStart);
    expect(windowsStart).toBeGreaterThan(rendererStart);
    expect(macosStart).toBeGreaterThan(windowsStart);
    expect(gateStart).toBeGreaterThan(macosStart);
    expect(source).toContain("node eng/ci/classify-change-scope.mjs");
    expect(source).toContain("windows_installer_mode: ${{ steps.scope.outputs.windows_installer_mode }}");
    expect(qualitySource).toContain("runs-on: macos-15");
    expect(qualitySource).not.toContain("windows-2025");
    expect(qualitySource).toContain("run: pnpm run check");
    expect(qualitySource).not.toContain("playwright test");
    expect(rendererSource).toContain("runs-on: macos-15");
    expect(rendererSource).not.toContain("run: pnpm run check");
    expect(rendererSource).toContain("pnpm exec playwright install --no-shell chromium");
    expect(rendererSource).toContain(
      "run: pnpm exec playwright test --project=renderer-chromium --workers=2 --retries=0"
    );
    expect(windowsSource).toContain("runs-on: windows-2025");
    expect(windowsSource).toContain("needs.change-scope.outputs.run_windows == 'true'");
    expect(windowsSource).not.toContain("run: pnpm run check");
    expect(windowsSource).toContain("pnpm run prepare:runtime-resources");
    expect(windowsSource).toContain("name: Restore Electron packaging downloads");
    expect(windowsSource).toContain("~/AppData/Local/electron/Cache");
    expect(windowsSource).toContain("~/AppData/Local/electron-builder/Cache");
    expect(windowsSource).toContain("pi67-electron-packaging-${{ runner.os }}-${{ runner.arch }}-");
    expect(windowsSource).toContain(
      "run: pnpm exec playwright test --project=electron --workers=1"
    );
    expect(windowsSource).toContain("--prepared-resources --ci-fast");
    expect(windowsSource).toContain("run: pnpm run package:smoke:windows-ui");
    expect(windowsSource).toContain("WINDOWS_INSTALLER_MODE: ${{ needs.change-scope.outputs.windows_installer_mode }}");
    expect(windowsSource).toContain("pnpm run package:smoke:windows-installer --quick");
    expect(windowsSource).toContain("pnpm run package:smoke:windows-installer\n");
    expect(macosSource).toContain("runs-on: macos-15");
    expect(macosSource).toContain("needs.change-scope.outputs.run_macos == 'true'");
    expect(macosSource).toContain("package-native-unsigned.mjs --prepared-resources");
    expect(source).toContain("name: CI Gate");
    expect(source).toContain("node eng/ci/verify-ci-gate.mjs");
    expect(source).toContain("RENDERER_RESULT: ${{ needs.renderer-e2e.result }}");
  });

  it("keeps unsigned previews fast without dropping packaged release gates", async () => {
    const source = await readFile(new URL("../../.github/workflows/unsigned-preview.yml", import.meta.url), "utf8");
    const provenanceStart = source.indexOf("  provenance:");
    const qualityStart = source.indexOf("  quality-gates:");
    const windowsStart = source.indexOf("  build-windows:");
    const macosStart = source.indexOf("  build-macos:");
    const certificationStart = source.indexOf("  certify-windows-installer:");
    const publishStart = source.indexOf("  publish:");
    const qualitySource = source.slice(qualityStart, windowsStart);
    const windowsSource = source.slice(windowsStart, macosStart);
    const macosSource = source.slice(macosStart, certificationStart);
    const certificationSource = source.slice(certificationStart, publishStart);
    const publishSource = source.slice(publishStart);

    expect(source).not.toContain("performance:measure");
    expect(source).not.toContain("PI67_PERF_SAMPLES");
    expect(provenanceStart).toBeGreaterThan(-1);
    expect(qualityStart).toBeGreaterThan(provenanceStart);
    expect(windowsStart).toBeGreaterThan(qualityStart);
    expect(macosStart).toBeGreaterThan(windowsStart);
    expect(certificationStart).toBeGreaterThan(macosStart);
    expect(publishStart).toBeGreaterThan(certificationStart);
    expect(source.match(/corepack pnpm run check\n/gu)).toHaveLength(1);
    expect(qualitySource).toContain("needs: provenance");
    expect(qualitySource).toContain("run: corepack pnpm run check");
    expect(windowsSource).not.toContain("corepack pnpm run check");
    expect(windowsSource).toContain("run: corepack pnpm run package:native:unsigned");
    expect(windowsSource).toContain("run: corepack pnpm run package:smoke");
    expect(windowsSource).toContain("run: corepack pnpm run package:smoke:windows-ui");
    expect(windowsSource).toContain("unsigned-preview-windows-candidate-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}");
    expect(windowsSource).toContain("artifacts/release/win-unpacked/Pi-67 Desktop.exe");
    expect(macosSource).not.toContain("corepack pnpm run check");
    expect(macosSource).toContain("run: corepack pnpm run package:native:unsigned");
    expect(macosSource).toContain("run: corepack pnpm run package:smoke");
    expect(certificationSource).toContain("needs: build-windows");
    expect(certificationSource).toContain("name: ${{ needs.build-windows.outputs.candidate_artifact_name }}");
    expect(certificationSource).toContain("eng/packaging/windows-artifact-identity.test.mjs");
    expect(certificationSource).toContain("run: corepack pnpm run package:smoke:windows-installer");
    expect(certificationSource).not.toContain("package:native:unsigned");
    expect(source).not.toContain("package:smoke:windows-installer -- --quick");
    expect(publishSource).toContain(
      "needs: [provenance, quality-gates, build-windows, build-macos, certify-windows-installer]"
    );
    expect(publishSource).toContain("name: ${{ needs.build-windows.outputs.candidate_artifact_name }}");
    expect(publishSource).toContain("name: ${{ needs.build-macos.outputs.candidate_artifact_name }}");
  });

  it("allows deep Windows certification and signed releases to finish", async () => {
    const certification = await readFile(
      new URL("../../.github/workflows/performance-certification.yml", import.meta.url),
      "utf8"
    );
    const release = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");

    expect(certification).toContain("timeout-minutes: 180");
    expect(certification).toContain("schedule:");
    expect(release).toContain("timeout-minutes: 180");
    expect(release).toContain("run: corepack pnpm run package:smoke:windows-installer");
    expect(release).not.toContain("package:smoke:windows-installer -- --quick");
  });
});
