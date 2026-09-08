import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("rejects focused tests in CI and emits structured Vitest reports", async () => {
  vi.stubEnv("CI", "true");
  vi.resetModules();
  const { default: vitest } = await import("../../vitest.config.ts");
  const { default: playwright } = await import("../../playwright.config.ts");
  expect(vitest.test.allowOnly).toBe(false);
  expect(playwright.forbidOnly).toBe(true);
  expect(vitest.test.reporters).toEqual(["default", "json", "junit"]);
  expect(vitest.test.outputFile).toEqual({
    json: "artifacts/quality/vitest-results.json",
    junit: "artifacts/quality/vitest-results.xml"
  });
});

it("keeps native Electron independent of the renderer server while retaining its checks", async () => {
  vi.stubEnv("CI", "true");
  vi.resetModules();
  const { default: combined } = await import("../../playwright.config.ts");
  const { default: native } = await import("../../playwright.electron.config.ts");
  expect(combined.webServer).toBeDefined();
  expect(native.webServer).toBeUndefined();
  expect(native.use.baseURL).toBeUndefined();
  expect(native.projects).toEqual(combined.projects.filter((project) => project.name === "electron"));
  expect(native.forbidOnly).toBe(true);
  expect(native.retries).toBe(combined.retries);
  expect(native.expect).toEqual(combined.expect);
  expect(native.use.trace).toBe(combined.use.trace);
  expect(native.use.screenshot).toBe(combined.use.screenshot);
});
