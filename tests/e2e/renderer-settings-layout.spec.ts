import { expect, test } from "@playwright/test";
import { DEFAULT_CONTEXT_MEMORY_CONFIGURATION } from "../../packages/domain/src/index.js";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";

const categories = ["外观", "账户与数据", "模型", "上下文与记忆", "视觉辅助", "扩展", "技能", "提示词模板", "工作规则", "飞书", "浏览器集成", "运行服务", "用量分析", "下载源与网络", "更新与诊断", "关于"];
const wide = new Set(["模型", "扩展", "技能", "提示词模板", "工作规则", "用量分析"]);

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 1000, 720]) {
    test(`Settings preserve alignment and usable controls in ${theme} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await installMockDesktopBridge(page);
      await page.addInitScript((preference) => localStorage.setItem("pi67.themePreference", preference), theme);
      await page.goto("/");
      await attachMockAgent(page, [], {}, { responseResults: {
        "context.config.get": { ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION, revision: "fixture-1" },
        "context.status.get": { provider: "openviking", health: "healthy", owner: "pi67-openviking", effectivePrivacyMode: "private-learning", endpoint: "http://127.0.0.1:1933", configured: true, conflictExtensions: [], lastCheckedAt: 1 },
        "enterprise.identity.get": { state: "signed-out" },
        "enterprise.workspace.get": { state: "unbound", workspaceId: DEFAULT_MOCK_WORKSPACE.id },
        "workspace.usage.report": { workspaceId: DEFAULT_MOCK_WORKSPACE.id, generatedAt: 1786220000000, window: "30d", buckets: [], models: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, coverage: { discoveredSessions: 0, scannedSessions: 0, skippedSessions: 0, unavailableSessions: 0, invalidSessions: 0, futureVersionSessions: 0, undatedUsageEntries: 0, complete: true } }
      } });
      await page.getByRole("button", { name: "选择工作区" }).click();
      await page.keyboard.press("Control+,");
      const settings = page.getByTestId("settings-workbench");
      let left: number | undefined;
      for (const category of categories) {
        if (width <= 720) {
          await settings.getByRole("button", { name: "选择设置分类", exact: true }).click();
          await page.getByRole("menuitem", { name: category, exact: true }).click();
        } else {
          await settings.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: category, exact: true }).click();
        }
        await expect(settings.getByRole("heading", { name: category, exact: true, level: 1 })).toBeVisible();
        await expect(settings.getByRole("heading", { level: 1 })).toHaveCount(1);
        const metrics = await settings.evaluate((element) => {
          const layout = element.querySelector<HTMLElement>("[data-content-width]")!;
          const frame = layout.parentElement!;
          const region = element.querySelector<HTMLElement>('[data-testid="settings-scroll-region"]')!;
          const heading = layout.querySelector("h1")!.getBoundingClientRect();
          return { width: layout.getBoundingClientRect().width, frame: frame.getBoundingClientRect().width,
            left: layout.getBoundingClientRect().left, headingLeft: heading.left,
            scrollWidth: region.scrollWidth, clientWidth: region.clientWidth };
        });
        expect(metrics.width).toBeCloseTo(wide.has(category) ? metrics.frame : Math.min(880, metrics.frame), 0);
        left ??= metrics.left;
        expect(Math.abs(metrics.left - left)).toBeLessThanOrEqual(1);
        expect(Math.abs(metrics.headingLeft - left)).toBeLessThanOrEqual(1);
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
        if (category === "上下文与记忆") await expect(settings.getByRole("radio")).toHaveCount(4);
        if (category === "用量分析") await expect(settings.getByText("Pi 记录 token", { exact: true })).toBeVisible();
        if (category === "账户与数据") {
          await expect(settings.getByText("本地模式", { exact: true })).toBeVisible();
          await expect(settings.getByText("数据与同步", { exact: true })).toBeVisible();
          await expect(settings.getByText("未登录", { exact: true })).toHaveCount(0);
        }
        if (category === "下载源与网络") {
          const header = settings.getByRole("heading", { level: 1 }).locator("../..");
          await expect(header.getByRole("button", { name: "保存更改", exact: true })).toBeDisabled();
        }
      }
      if (width > 720) {
        const navigation = settings.getByRole("navigation", { name: "设置分类" });
        const selected = navigation.getByRole("button", { name: "关于", exact: true });
        const hovered = navigation.getByRole("button", { name: "工作规则", exact: true });
        await hovered.hover();
        await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
        expect(await selected.evaluate((node) => getComputedStyle(node).backgroundColor))
          .not.toBe(await hovered.evaluate((node) => getComputedStyle(node).backgroundColor));
      }
    });
  }
}
