import { expect, test, type Page } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";

// Measurable parts of the DESIGN Visual quality bar that packaged reviews caught by eye.
// Screenshots are never committed, so these assert numbers and computed styles instead.

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

async function openSettings(page: Page) {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  const settings = page.getByLabel("New Money 设置");
  await expect(settings).toBeVisible();
  return settings;
}

test("keeps every Settings category on one title position, content offset and width", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  const settings = await openSettings(page);
  const categories = settings.getByRole("navigation", { name: "设置分类" }).getByRole("button");
  const names = (await categories.allTextContents()).map((name) => name.trim()).filter(Boolean);
  expect(names.length).toBeGreaterThanOrEqual(10);
  const layouts = new Map<string, string>();
  for (const name of names) {
    await categories.filter({ hasText: name }).first().click();
    const heading = settings.getByRole("heading", { level: 1, name, exact: true });
    await expect(heading).toBeVisible();
    layouts.set(name, await heading.evaluate((h1) => {
      const header = h1.closest("header") ?? h1;
      const next = header.nextElementSibling?.getBoundingClientRect();
      const box = h1.getBoundingClientRect();
      return [box.left, box.top, next?.top, next?.left, next?.width].map((value) => Math.round(value ?? -1)).join(",");
    }));
  }
  // Switching siblings must not move the title, the first block or the column width.
  expect(new Set(layouts.values()), JSON.stringify(Object.fromEntries(layouts))).toHaveProperty("size", 1);
});

test("draws keycaps in the UI face and never rings a focused dialog container", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  const monospaceKeycaps = () => page.locator("kbd").evaluateAll((keys) => keys
    .filter((key) => /monospace|mono\b|Menlo|Consolas/iu.test(getComputedStyle(key).fontFamily))
    .map((key) => key.textContent));
  const dialogRing = (name: string) => page.getByRole("dialog", { name }).evaluate((dialog) => {
    (dialog as HTMLElement).focus();
    return getComputedStyle(dialog).outlineStyle;
  });

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "命令面板" }).locator("kbd").first()).toBeVisible();
  expect(await monospaceKeycaps()).toEqual([]);
  expect(await dialogRing("命令面板")).toBe("none");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+/");
  await expect(page.getByRole("dialog", { name: "键盘快捷键" }).locator("kbd").first()).toBeVisible();
  expect(await monospaceKeycaps()).toEqual([]);
  expect(await dialogRing("键盘快捷键")).toBe("none");
  // Alternative bindings (⌘N 或 ⌘T) stay on one line, as in Settings › 快捷键.
  const keycapRows = await page.getByRole("dialog", { name: "键盘快捷键" }).locator("kbd").evaluateAll((keys) => {
    const lines = new Map<Element, Set<number>>();
    for (const key of keys) {
      const row = key.closest("[class*='row']") ?? key.parentElement!;
      lines.set(row, (lines.get(row) ?? new Set()).add(Math.round(key.getBoundingClientRect().top)));
    }
    return [...lines.values()].map((tops) => tops.size);
  });
  expect(keycapRows.length).toBeGreaterThan(0);
  expect(keycapRows.every((count) => count === 1), JSON.stringify(keycapRows)).toBe(true);
});
