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
    const fastStart = source.indexOf("  quality-and-renderer:");
    const windowsStart = source.indexOf("  native-windows:");
    const macosStart = source.indexOf("  native-macos:");
    const gateStart = source.indexOf("  ci-gate:");
    const fastSource = source.slice(fastStart, windowsStart);
    const windowsSource = source.slice(windowsStart, macosStart);
    const macosSource = source.slice(macosStart, gateStart);

    expect(source).not.toContain("performance:measure");
    expect(source).not.toContain("PI67_PERF_SAMPLES");
    expect(source).toContain("group: ci-${{ github.workflow }}-${{ github.ref }}");
    expect(source).toContain("cancel-in-progress: true");
    expect(scopeStart).toBeGreaterThan(-1);
    expect(fastStart).toBeGreaterThan(scopeStart);
    expect(windowsStart).toBeGreaterThan(fastStart);
    expect(macosStart).toBeGreaterThan(windowsStart);
    expect(gateStart).toBeGreaterThan(macosStart);
    expect(source).toContain("node eng/ci/classify-change-scope.mjs");
    expect(source).toContain("windows_installer_mode: ${{ steps.scope.outputs.windows_installer_mode }}");
    expect(fastSource).toContain("runs-on: macos-15");
    expect(fastSource).not.toContain("windows-2025");
    expect(fastSource).toContain("run: pnpm run check");
    expect(fastSource).toContain(
      "run: pnpm exec playwright test --project=renderer-chromium --workers=2"
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
  });

  it("keeps unsigned previews fast without dropping packaged release gates", async () => {
    const source = await readFile(new URL("../../.github/workflows/unsigned-preview.yml", import.meta.url), "utf8");

    expect(source).not.toContain("performance:measure");
    expect(source).not.toContain("PI67_PERF_SAMPLES");
    expect(source).toContain("timeout-minutes: 30");
    expect(source).toContain("run: corepack pnpm run package:native:unsigned");
    expect(source).toContain("run: corepack pnpm run package:smoke");
    expect(source).toContain("run: corepack pnpm run package:smoke:windows-ui");
    expect(source).toContain("run: corepack pnpm run package:smoke:windows-installer");
    expect(source).not.toContain("package:smoke:windows-installer -- --quick");
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
