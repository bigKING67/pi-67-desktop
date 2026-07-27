import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  emitMockAgentEvent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("shows the bounded per-surface Extension Catalog and rejects stale generations", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("tab", { name: "上下文", exact: true }).click();

  const catalog = page.getByRole("region", { name: "Extension 目录" });
  await expect(catalog.getByText("example-extension")).toBeVisible();
  await expect(catalog.getByText("已适配")).toBeVisible();
  await expect(catalog.getByText("1 命令 · 1 工具")).toBeVisible();
  await expect(catalog.getByText("声明式 Adapter · @verified/example@1.2.3 · 1 命令 / 1 工具")).toBeVisible();
  await expect(catalog.getByText("pi67-desktop-safety")).toHaveCount(0);

  await emitMockAgentEvent(page, {
    type: "extension.catalog.changed",
    payload: {
      items: [{
        id: "/extensions/stale.ts",
        label: "stale-extension",
        path: "/extensions/stale.ts",
        loadState: "loaded",
        source: { path: "/extensions/stale.ts", source: "stale-extension", scope: "project", origin: "top-level" },
        assessment: {
          overall: "unknown",
          detail: "stale",
          surfaces: [
            { surface: "commands", status: "not-present", detail: "none" },
            { surface: "tools", status: "not-present", detail: "none" },
            { surface: "ui-primitives", status: "unknown", detail: "unknown" },
            { surface: "tui-custom", status: "unknown", detail: "unknown" }
          ]
        },
        commandCount: 0,
        toolCount: 0
      }],
      total: 1,
      truncated: false
    }
  }, { sessionGeneration: 0 });

  await expect(catalog.getByText("stale-extension")).toHaveCount(0);
  await expect(catalog.getByText("example-extension")).toBeVisible();
});
