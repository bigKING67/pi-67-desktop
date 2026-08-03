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

  it("keeps CI fast while preparing clean-checkout E2E resources and reusing one build", async () => {
    const source = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

    expect(source).not.toContain("performance:measure");
    expect(source).not.toContain("PI67_PERF_SAMPLES");
    expect(source).toContain("corepack pnpm run build");
    expect(source).toContain("corepack pnpm run prepare:toolchain");
    expect(source).toContain("corepack pnpm run prepare:capabilities");
    expect(source).toContain("run: corepack pnpm exec playwright test");
    expect(source).toContain("run: corepack pnpm exec node eng/packaging/package-native-unsigned.mjs");
    expect(source.indexOf("corepack pnpm run build"))
      .toBeLessThan(source.indexOf("corepack pnpm run prepare:toolchain"));
    expect(source.indexOf("corepack pnpm run prepare:toolchain"))
      .toBeLessThan(source.indexOf("corepack pnpm run prepare:capabilities"));
    expect(source.indexOf("corepack pnpm run prepare:capabilities"))
      .toBeLessThan(source.indexOf("corepack pnpm exec playwright test"));
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
  });
});
