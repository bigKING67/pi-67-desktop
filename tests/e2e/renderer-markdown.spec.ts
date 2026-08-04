import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  waitForMockWorkspaceReady
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("lazy-loads accessible KaTeX and confines wide formulae to their own viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  const initialResources = await page.evaluate(() => (
    performance.getEntriesByType("resource").map((entry) => entry.name)
  ));
  expect(initialResources.some(isMathResource)).toBe(false);

  const wideExpression = Array.from({ length: 80 }, (_, index) => `x_{${index + 1}}`).join("+");
  await attachMockAgent(page, [{
    id: "markdown-math-message",
    role: "assistant",
    parts: [{
      type: "text",
      text: [
        "行内公式 $E=mc^2$ 与 \\(x+y\\)。",
        "",
        "$$a^2+b^2=c^2$$",
        "",
        "\\[\\int_0^1 x^2 \\, dx\\]",
        "",
        `\\[${wideExpression}\\]`
      ].join("\n")
    }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);

  await expect.poll(() => page.locator(".katex").count()).toBeGreaterThanOrEqual(5);
  await expect.poll(() => page.locator(".katex-mathml math").count()).toBeGreaterThanOrEqual(5);
  const displayFormula = page.locator('[data-math-display="true"]').last();
  await expect(displayFormula).toBeVisible();
  const formulaMetrics = await displayFormula.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth
  }));
  expect(formulaMetrics.scrollWidth).toBeGreaterThan(formulaMetrics.clientWidth);
  expect(formulaMetrics.documentScrollWidth).toBe(formulaMetrics.documentClientWidth);
  await displayFormula.focus();
  await expect(displayFormula).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => displayFormula.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  const loadedResources = await page.evaluate(() => (
    performance.getEntriesByType("resource").map((entry) => entry.name)
  ));
  expect(loadedResources.some(isMathResource)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("markdown-math-dark.png"), animations: "disabled" });

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: testInfo.outputPath("markdown-math-light.png"), animations: "disabled" });
});

test("never mounts or requests Markdown image sources", async ({ page }) => {
  const requestedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "markdown-image-message",
    role: "assistant",
    parts: [{
      type: "text",
      text: [
        "![远程图](https://images.example.test/remote.png)",
        "",
        "![工作区图](./assets/local.png)",
        "",
        "![内嵌图](data:image/png;base64,AAAA)"
      ].join("\n")
    }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);

  await expect(page.getByRole("img", { name: "远程图" })).toBeVisible();
  await expect(page.getByRole("img", { name: "工作区图" })).toBeVisible();
  await expect(page.getByRole("img", { name: "内嵌图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开图片链接" })).toBeVisible();
  await expect(page.locator('[data-message-id="markdown-image-message"] img')).toHaveCount(0);
  expect(requestedUrls.some((url) => url.startsWith("https://images.example.test/"))).toBe(false);
});

function isMathResource(name: string): boolean {
  return /(?:MarkdownMathDocument|katex(?:\.min)?\.css|katex[/_-].*\.(?:woff2?|ttf))/u.test(name);
}
