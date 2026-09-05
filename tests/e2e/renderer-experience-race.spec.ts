import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("a late Workspace overview cannot replace the selected Workspace's Experience panel", async ({ page }) => {
  test.skip(process.env.PI67_E2E_RENDERER_MODE === "preview", "This isolated React lifecycle fixture uses Vite source modules; run in development mode.");
  const fixturePath = resolve("tests/e2e/experience-panel-race-fixture.html").replaceAll("\\", "/");
  await page.goto(`/@fs/${fixturePath}`);
  const panel = page.getByTestId("experience-inspector");
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Switch workspace B" }).click();
  await expect(panel).toContainText("项目未绑定");
  await page.getByRole("button", { name: "Resolve workspace A" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-old-response", "settled");
  await expect(panel).not.toContainText("项目已绑定");
  await expect(panel).toContainText("项目未绑定");
});
