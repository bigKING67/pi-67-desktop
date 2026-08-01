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

test("shows executable tool names without implying partial execution support", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    extensionCatalog: {
      items: [{
        id: "npm:pi-web-access",
        label: "npm:pi-web-access",
        path: "npm:pi-web-access",
        loadState: "loaded",
        source: {
          path: "npm:pi-web-access",
          source: "npm:pi-web-access",
          scope: "user",
          origin: "package"
        },
        assessment: {
          overall: "partial",
          detail: "命令和工具可以执行；部分 Pi TUI 展示能力没有 Desktop 专用 Adapter。",
          surfaces: [
            { surface: "commands", status: "supported", detail: "4 个命令。" },
            { surface: "tools", status: "partial", detail: "4 个工具可执行，使用通用 Tool 卡展示。" },
            { surface: "ui-primitives", status: "unknown", detail: "没有可靠调用方归属。" },
            { surface: "tui-custom", status: "unknown", detail: "没有足够证据。" }
          ]
        },
        commandCount: 4,
        toolCount: 4,
        toolNames: ["web_search", "source_check", "fetch_content", "get_search_content"]
      }],
      total: 1,
      truncated: false
    }
  });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("tab", { name: "上下文", exact: true }).click();

  const item = page.getByRole("region", { name: "Extension 目录" })
    .getByRole("listitem")
    .filter({ hasText: "npm:pi-web-access" });
  await expect(item.getByText("执行可用 · 展示受限", { exact: true })).toBeVisible();
  await expect(item.getByText("已注册工具", { exact: true })).toBeVisible();
  await expect(item.getByText("web_search", { exact: true })).toBeVisible();
  await expect(item.getByText("source_check", { exact: true })).toBeVisible();
  await expect(item.getByText("fetch_content", { exact: true })).toBeVisible();
  await expect(item.getByText("get_search_content", { exact: true })).toBeVisible();
  await expect(item.getByLabel(/工具：可执行/u)).toBeVisible();
});
