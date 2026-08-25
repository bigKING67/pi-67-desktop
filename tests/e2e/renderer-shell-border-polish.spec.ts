import { expect, test, type Locator } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  waitForMockWorkspaceReady
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("keeps shell ownership while quieting resting header and Composer chrome", async ({ page }) => {
  await page.setViewportSize({ width: 1_600, height: 900 });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);

  const navigation = page.locator("#session-navigation");
  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  const navigationSearch = page.getByRole("searchbox", { name: "搜索对话" });
  const inspectorSearch = inspector.getByRole("textbox", { name: "搜索工作区文件" });
  const composerShell = page.getByTestId("composer-shell");
  const composer = page.getByLabel("给 Pi 发送消息");
  const modelControl = page.getByRole("button", { name: "Pi 模型", exact: true });
  const idleConversation = page.getByTestId("conversation-row")
    .filter({ hasNotText: /运行中|等待|草稿|稍后/u })
    .first();

  await expect(inspector).toBeVisible();
  await expect(modelControl).toBeVisible();
  await expect(idleConversation).toBeVisible();
  expect(await leadingCopyInset(idleConversation)).toBeLessThan(16);
  await expect(navigation.locator("header").first()).toHaveCSS("border-bottom-width", "0px");
  await expect(inspector.getByRole("tablist", { name: "任务检查器" }))
    .toHaveCSS("border-bottom-width", "0px");
  await expectRestingSearch(navigationSearch, "rgb(255, 255, 255)");
  await expectRestingSearch(inspectorSearch, "rgb(255, 255, 255)");

  await navigationSearch.hover();
  await expect(searchHost(navigationSearch)).toHaveCSS("border-top-color", "rgb(200, 206, 200)");
  await navigationSearch.focus();
  await expectFocusedSearch(navigationSearch, "rgb(44, 112, 201)");
  await expect(navigationSearch).toHaveCSS("outline-style", "none");
  await expect(navigationSearch).toHaveCSS("outline-width", "0px");

  await inspectorSearch.hover();
  await expect(searchHost(inspectorSearch))
    .toHaveCSS("border-top-color", "rgb(200, 206, 200)");
  await inspectorSearch.focus();
  await expectFocusedSearch(inspectorSearch, "rgb(44, 112, 201)");

  await composer.focus();
  await expect(composerShell).toHaveCSS("border-top-color", "rgb(44, 112, 201)");
  await expect(composerShell).toHaveCSS("box-shadow", /44, 112, 201/u);
  await modelControl.focus();
  await expect(composerShell).toHaveCSS("border-top-color", "rgb(200, 206, 200)");
  await expect(composerShell).toHaveCSS("box-shadow", /18, 27, 22/u);
  await expect(modelControl).toHaveCSS("border-top-color", "rgb(44, 112, 201)");
  await expect(modelControl).toHaveCSS("box-shadow", /44, 112, 201/u);

  await page.screenshot({
    path: "artifacts/visual-review/shell-border-polish-light.png",
    animations: "disabled"
  });

  await page.mouse.move(0, 0);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectRestingSearch(navigationSearch, "rgb(24, 28, 25)");
  await expectRestingSearch(inspectorSearch, "rgb(24, 28, 25)");
  await expect(navigation.locator("header").first()).toHaveCSS("border-bottom-width", "0px");
  await expect(inspector.getByRole("tablist", { name: "任务检查器" }))
    .toHaveCSS("border-bottom-width", "0px");
  await page.screenshot({
    path: "artifacts/visual-review/shell-border-polish-dark.png",
    animations: "disabled"
  });
});

test("keeps quiet shell fields usable without horizontal overflow in the narrow drawer", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 640 });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);

  const inspectorToggle = page.getByTestId("inspector-toggle");
  if (await inspectorToggle.getAttribute("aria-expanded") === "false") await inspectorToggle.click();
  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  const inspectorSearch = inspector.getByRole("textbox", { name: "搜索工作区文件" });
  await expect(inspector).toBeVisible();
  await inspectorSearch.fill("index");
  await inspectorSearch.press("Enter");
  await expect(inspector.getByRole("tree", { name: "工作区文件搜索结果" })).toBeVisible();
  await expect(searchHost(inspectorSearch)).toHaveCSS("border-top-color", "rgb(44, 112, 201)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(await page.evaluate(() => document.documentElement.clientWidth));
  await page.screenshot({
    path: "artifacts/visual-review/shell-border-polish-narrow.png",
    animations: "disabled"
  });
});

async function expectRestingSearch(search: Locator, surfaceColor: string): Promise<void> {
  const host = searchHost(search);
  await expect(host).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(host).toHaveCSS("background-color", surfaceColor);
}

async function expectFocusedSearch(search: Locator, focusColor: string): Promise<void> {
  await expect(searchHost(search)).toHaveCSS("border-top-color", focusColor);
  await expect(searchHost(search)).toHaveCSS("box-shadow", /0\.22/u);
}

function searchHost(search: Locator): Locator {
  return search.locator("xpath=..");
}

async function leadingCopyInset(row: Locator): Promise<number> {
  const rowBox = await row.boundingBox();
  const copyBox = await row.getByTestId("conversation-copy").boundingBox();
  expect(rowBox).not.toBeNull();
  expect(copyBox).not.toBeNull();
  return copyBox!.x - rowBox!.x;
}
