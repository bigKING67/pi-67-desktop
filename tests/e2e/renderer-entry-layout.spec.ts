import { expect, test, type Locator, type Page } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";
import { openWorkbench } from "./renderer-workbench-test-fixture.js";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page, { inspectorDocked: "unset" });
});

for (const theme of ["light", "dark"] as const) {
  test(`centers the empty entry group on the Composer's left edge with the Inspector closed in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    await attachMockAgent(page);
    await page.getByRole("button", { name: "选择工作区" }).click();

    const welcome = page.locator('[data-transcript-empty="true"]');
    await expect(welcome).toBeVisible();
    await expect(page.locator("#task-inspector")).toHaveCount(0);
    await expect(page.getByTestId("inspector-toggle")).toHaveAttribute("aria-expanded", "false");

    const composer = page.getByTestId("composer-shell");
    const heading = welcome.getByRole("heading", { level: 2 });
    const [welcomeBox, headingBox, composerBox] = await Promise.all([box(welcome), box(heading), box(composer)]);
    expect(Math.abs(headingBox.x - composerBox.x)).toBeLessThanOrEqual(1);
    // The welcome sits on the Composer, and the group floats above the window bottom.
    expect(composerBox.y - (welcomeBox.y + welcomeBox.height)).toBeLessThan(64);
    expect(900 - (composerBox.y + composerBox.height)).toBeGreaterThan(160);
    await page.screenshot({ path: `artifacts/visual-review/entry-layout-${theme}.png` });
  });
}

test("gives a new-conversation draft the same centered entry group", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openWorkbench(page, { inspectorDocked: "unset" });
  await page.keyboard.press(`${modifier}+n`);
  const surface = page.getByTestId("new-session-intent");
  await expect(surface).toBeVisible();
  const intro = surface.locator('[data-transcript-empty="true"]');
  const [introBox, headingBox, composerBox] = await Promise.all([
    box(intro),
    box(intro.getByRole("heading", { level: 2 })),
    box(page.getByTestId("composer-shell"))
  ]);
  expect(Math.abs(headingBox.x - composerBox.x)).toBeLessThanOrEqual(1);
  expect(composerBox.y - (introBox.y + introBox.height)).toBeLessThan(64);
  expect(900 - (composerBox.y + composerBox.height)).toBeGreaterThan(120);
  await page.screenshot({ path: "artifacts/visual-review/entry-layout-new-session.png" });
});

test("docks the Composer after the first Turn and remembers only explicit docked Inspector choices", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "user-entry-layout",
    role: "user",
    createdAt: Date.UTC(2026, 9, 7, 5, 0, 0),
    parts: [{ type: "text", text: "你好" }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.locator('[data-message-id="user-entry-layout"]')).toBeVisible();
  await expect(page.locator('[data-transcript-empty="true"]')).toHaveCount(0);
  const composerBox = await box(page.getByTestId("composer-shell"));
  expect(900 - (composerBox.y + composerBox.height)).toBeLessThan(40);

  await page.getByTestId("inspector-toggle").click();
  await expect(page.getByTestId("inspector-toggle")).toHaveAttribute("aria-expanded", "true");
  expect(await dockedPreference(page)).toBe("open");

  await page.getByTestId("inspector-toggle").click();
  expect(await dockedPreference(page)).toBe("closed");
});

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("Entry layout geometry was unavailable");
  return value;
}

function dockedPreference(page: Page) {
  return page.evaluate(() => window.localStorage.getItem("pi67.inspector-docked.v1"));
}
