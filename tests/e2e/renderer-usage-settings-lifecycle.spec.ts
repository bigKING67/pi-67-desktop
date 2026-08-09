import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommandDetails,
  replaceMockAgentHost,
  setMockAgentResponseDelay,
  setMockAgentResponseResult
} from "./pi67-renderer-fixture.js";
import { disconnectMockAgentHost } from "./pi67-renderer-controls.js";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";

test("starts the newly selected usage window while the prior scan is loading", async ({ page }) => {
  await openUsageSettings(page);
  await setMockAgentResponseResult(page, "workspace.usage.report", usageReport("30d", 30));
  await setMockAgentResponseDelay(page, "workspace.usage.report", 500);

  await page.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "用量分析", exact: true }).click();
  await expect(page.getByText("正在扫描 Pi JSONL", { exact: true })).toBeVisible();
  await expect.poll(async () => usageWindows(page)).toContain("30d");

  await setMockAgentResponseResult(page, "workspace.usage.report", usageReport("7d", 7));
  await page.getByRole("button", { name: "7 天", exact: true }).click();

  await expect.poll(async () => usageWindows(page)).toContain("7d");
  await expect(page.getByText("Pi 记录 token", { exact: true }).locator("..").getByText("7", { exact: true }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "重建", exact: true })).toBeEnabled();
});

test("clears a stale loading state and rebuilds after reconnecting to the same Host epoch", async ({ page }) => {
  await openUsageSettings(page);
  await setMockAgentResponseResult(page, "workspace.usage.report", usageReport("30d", 30));
  await setMockAgentResponseDelay(page, "workspace.usage.report", 1_000);
  await page.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "用量分析", exact: true }).click();
  await expect(page.getByText("正在扫描 Pi JSONL", { exact: true })).toBeVisible();
  await clearRecordedCommands(page);

  await disconnectMockAgentHost(page);
  await expect(page.getByText("Agent Host 未连接，暂时无法扫描 Pi JSONL。", { exact: true }))
    .toBeVisible();
  await expect(page.getByText("正在扫描 Pi JSONL", { exact: true })).toHaveCount(0);

  await setMockAgentResponseDelay(page, "workspace.usage.report", 0);
  await setMockAgentResponseResult(page, "workspace.usage.report", usageReport("30d", 31));
  await replaceMockAgentHost(page, 1);

  await expect(page.getByText("Agent Host 未连接，暂时无法扫描 Pi JSONL。", { exact: true }))
    .toHaveCount(0);
  await expect.poll(async () => usageWindows(page)).toContain("30d");
  await expect(page.getByText("Pi 记录 token", { exact: true }).locator("..").getByText("31", { exact: true }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "重建", exact: true })).toBeEnabled();
});

async function openUsageSettings(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1040, height: 800 });
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");
}

async function usageWindows(page: Page): Promise<string[]> {
  return (await recordedCommandDetails(page))
    .filter((command) => command.type === "workspace.usage.report")
    .map((command) => (command.payload as { window: string }).window);
}

function usageReport(window: "7d" | "30d" | "90d", total: number) {
  return {
    workspaceId: DEFAULT_MOCK_WORKSPACE.id,
    generatedAt: 1_786_220_000_000,
    window,
    buckets: [],
    models: [],
    totals: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total },
    coverage: {
      discoveredSessions: 0,
      scannedSessions: 0,
      skippedSessions: 0,
      unavailableSessions: 0,
      invalidSessions: 0,
      futureVersionSessions: 0,
      undatedUsageEntries: 0,
      complete: true
    }
  };
}
