import { expect, test, type Locator } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  type FixtureMessage
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("keeps Workspace file controls flat and visually consistent", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [userMessage("message-1", "Inspect the Workspace toolbar")]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  const filesToolbar = inspector.locator(".inspector-files-toolbar");
  const toolbarActions = filesToolbar.locator(".inspector-files-toolbar-actions");
  const createButton = filesToolbar.getByRole("button", { name: "新建工作区项目" });
  const refreshButton = filesToolbar.getByRole("button", { name: "刷新文件" });
  await expect(createButton).toHaveAttribute("aria-describedby", "workspace-create-tooltip");
  await expect(refreshButton).toHaveAttribute("aria-describedby", "workspace-refresh-tooltip");

  const createTooltip = createButton.locator(".inspector-toolbar-tooltip");
  const refreshTooltip = refreshButton.locator(".inspector-toolbar-tooltip");
  await expect(createTooltip).toBeHidden();
  await expect(refreshTooltip).toBeHidden();
  expect(await createTooltip.evaluate((tooltip) => tooltip.parentElement?.tagName)).toBe("BUTTON");
  expect(await refreshTooltip.evaluate((tooltip) => tooltip.parentElement?.tagName)).toBe("BUTTON");

  const toolbarTargets = await Promise.all([
    createButton.boundingBox(),
    refreshButton.boundingBox()
  ]);
  for (const target of toolbarTargets) {
    expect(target?.width).toBeGreaterThanOrEqual(28);
    expect(target?.height).toBeGreaterThanOrEqual(28);
  }
  expect(toolbarTargets[0]?.width).toBeLessThanOrEqual(48);
  expect(toolbarTargets[0]?.height).toBe(toolbarTargets[1]?.height);

  const toolbarStyles = await Promise.all([
    flatSurfaceStyle(filesToolbar),
    flatSurfaceStyle(toolbarActions)
  ]);
  for (const style of toolbarStyles) {
    expect(style).toEqual({
      background: "rgba(0, 0, 0, 0)",
      borderWidth: "0px",
      borderRadius: "0px",
      boxShadow: "none"
    });
  }

  const buttonStyles = await Promise.all([
    flatSurfaceStyle(createButton),
    flatSurfaceStyle(refreshButton)
  ]);
  expect(buttonStyles[0]).toEqual(buttonStyles[1]);
  expect(buttonStyles[0]).toEqual({
    background: "rgba(0, 0, 0, 0)",
    borderWidth: "0px",
    borderRadius: "6px",
    boxShadow: "none"
  });

  await createButton.hover();
  await expect(createTooltip).toBeVisible();
  const createHover = await createButton.evaluate((button) => getComputedStyle(button).backgroundColor);
  await refreshButton.hover();
  await expect(createTooltip).toBeHidden();
  await expect(refreshTooltip).toBeVisible();
  const refreshHover = await refreshButton.evaluate((button) => getComputedStyle(button).backgroundColor);
  expect(createHover).toBe(refreshHover);
  expect(createHover).not.toBe("rgba(0, 0, 0, 0)");
});

async function flatSurfaceStyle(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow
    };
  });
}

function userMessage(id: string, text: string): FixtureMessage {
  return { id, role: "user", createdAt: 1, parts: [{ type: "text", text }] };
}
