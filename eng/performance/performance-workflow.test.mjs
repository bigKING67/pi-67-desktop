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
    expect(packageJson.scripts["performance:measure"]).toContain("measure-session-catalog.mjs");
  });

  it("keeps 500 MiB large-Session work explicit and outside ordinary CI", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    const certification = await readFile(
      new URL("../../.github/workflows/performance-certification.yml", import.meta.url),
      "utf8"
    );
    const ordinaryCi = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

    expect(packageJson.scripts["performance:large-session"]).toContain("measure-large-session-jsonl.mjs");
    expect(certification).toContain("large_session_profile:");
    expect(certification).toContain("- standard");
    expect(certification).toContain("- extended");
    expect(certification).toContain("PI67_PERF_LARGE_SESSION_PROFILE:");
    expect(certification).toContain("PI67_PERF_LARGE_SESSION_SAMPLES: 1");
    expect(certification).toContain("run: corepack pnpm run performance:large-session");
    expect(ordinaryCi).not.toContain("performance:large-session");
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
    expect(rendererSource).toContain("pnpm --filter @pi67/protocol... run build");
    expect(rendererSource).toContain("pnpm --filter @pi67/renderer run build");
    expect(rendererSource).toContain("pnpm exec playwright install --no-shell chromium");
    expect(rendererSource).toContain("PI67_E2E_RENDERER_MODE: preview");
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

  it("separates testable Windows candidates from unsigned preview promotion", async () => {
    const candidate = await readFile(
      new URL("../../.github/workflows/windows-candidate.yml", import.meta.url),
      "utf8"
    );
    const promotion = await readFile(
      new URL("../../.github/workflows/unsigned-preview.yml", import.meta.url),
      "utf8"
    );
    const candidateBuild = candidate.slice(
      candidate.indexOf("  build-windows:"),
      candidate.indexOf("  certify-installer:")
    );
    const candidateCertification = candidate.slice(candidate.indexOf("  certify-installer:"));
    const promotionMac = promotion.slice(
      promotion.indexOf("  build-macos:"),
      promotion.indexOf("  verify-promotion:")
    );
    const promotionVerification = promotion.slice(
      promotion.indexOf("  verify-promotion:"),
      promotion.indexOf("  publish:")
    );
    const publish = promotion.slice(promotion.indexOf("  publish:"));

    expect(candidate).not.toContain("gh release create");
    expect(candidateBuild).toContain("run: corepack pnpm run package:native:unsigned");
    expect(candidateBuild).toContain("run: corepack pnpm run package:smoke");
    expect(candidateBuild).toContain("run: corepack pnpm run package:smoke:windows-ui");
    expect(candidateBuild).toContain("windows-preview-candidate-identity.json");
    expect(candidateCertification).toContain("needs: [provenance, build-windows]");
    expect(candidateCertification).toContain("run: corepack pnpm run package:smoke:windows-installer");
    expect(candidateCertification).toContain("windows-candidate-${{ github.run_id }}-${{ github.run_attempt }}");
    expect(candidateCertification).not.toContain("package:native:unsigned");
    expect(promotion.match(/corepack pnpm run check\n/gu)).toHaveLength(1);
    expect(promotion).not.toContain("build-windows:");
    expect(promotionMac).toContain("run: corepack pnpm run package:native:unsigned");
    expect(promotionMac).toContain("run: corepack pnpm run package:smoke");
    expect(promotionVerification).toContain("Download exact manually tested Windows candidate");
    expect(promotionVerification).toContain("run-id: ${{ inputs.candidate_run_id }}");
    expect(promotionVerification).toContain("release:preview:promotion:verify");
    expect(promotionVerification).toContain("release:preview:bundle:prepare");
    expect(publish).toContain("Download verified unsigned preview bundle");
    expect(publish).not.toContain("actions/checkout");
    expect(publish).not.toContain("pnpm/action-setup");
    expect(publish).not.toContain("corepack pnpm");
    expect(publish).toContain("--target \"$SOURCE_COMMIT\"");
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
