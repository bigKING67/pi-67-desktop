import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://127.0.0.1:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "renderer-chromium",
      testMatch: /renderer\.spec\.ts/u,
      use: { ...devices["Desktop Chrome"], channel: "chromium", viewport: { width: 1440, height: 920 } }
    },
    {
      name: "electron",
      testMatch: /electron\.spec\.ts/u
    }
  ],
  webServer: {
    command: "corepack pnpm --filter @pi67/renderer run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
