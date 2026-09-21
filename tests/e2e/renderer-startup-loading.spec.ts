import { expect, test } from "@playwright/test";
import { openWorkbench } from "./renderer-workbench-test-fixture.js";

test("does not fetch the intent surface during initialization but loads it for an explicit new draft", async ({ page }) => {
  const intentRequests: string[] = [];
  page.on("request", request => {
    if (/NewSessionIntentSurface(?:-|\.tsx)/u.test(request.url())) intentRequests.push(request.url());
  });
  await openWorkbench(page);
  expect(intentRequests).toEqual([]);
  await page.getByRole("button", { name: "在 pi-demo 新建对话" }).click();
  await expect(page.getByTestId("new-session-intent")).toBeVisible();
  expect(intentRequests.length).toBeGreaterThan(0);
  await expect(page.getByTestId("composer-region").getByRole("textbox")).toBeVisible();
});
