import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge, waitForMockWorkspaceReady } from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("shows an open folder for an expanded Workspace and working animals in the mode switch", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);

  const collapse = page.getByRole("button", { name: /^折叠工作区：/u }).first();
  const name = (await collapse.getAttribute("aria-label"))!.replace("折叠工作区：", "");
  await expect(collapse.locator("xpath=ancestor::section").locator(".lucide-folder-open")).toHaveCount(1);
  await collapse.click();
  const collapsed = page.getByRole("button", { name: `展开工作区：${name}` }).locator("xpath=ancestor::section");
  await expect(collapsed.locator(".lucide-folder-open")).toHaveCount(0);
  await expect(collapsed.locator(".lucide-folder")).toHaveCount(1);

  for (const mode of ["work", "chat"]) {
    const icon = page.getByTestId(`workspace-mode-${mode}`).locator("svg[aria-hidden='true']");
    await expect(icon).toHaveCount(1);
  }
  // Deadpan pair: the horse is the Lab head with side-eye, brow and smirk; the ox has 14 strokes.
  await expect(page.getByTestId("workspace-mode-chat").locator("svg path")).toHaveCount(6);
  await expect(page.getByTestId("workspace-mode-work").locator("svg path")).toHaveCount(14);
});
