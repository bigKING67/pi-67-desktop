import { defineConfig, devices } from "@playwright/test";

const rendererPort = process.env.PI67_E2E_RENDERER_PORT ?? "5173";
if (!/^\d{1,5}$/u.test(rendererPort) || Number(rendererPort) < 1 || Number(rendererPort) > 65_535) {
  throw new Error("PI67_E2E_RENDERER_PORT must be a valid TCP port.");
}
const rendererUrl = `http://127.0.0.1:${rendererPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  expect: { timeout: 5_000 },
  use: {
    baseURL: rendererUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "renderer-chromium",
      testMatch: /renderer(?:-[a-z-]+)?\.spec\.ts/u,
      use: { ...devices["Desktop Chrome"], channel: "chromium", viewport: { width: 1440, height: 920 } }
    },
    {
      name: "electron",
      testMatch: /electron\.spec\.ts/u
    }
  ],
  webServer: {
    command: `corepack pnpm --filter @pi67/renderer exec vite --host 127.0.0.1 --port ${rendererPort} --strictPort`,
    url: rendererUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
