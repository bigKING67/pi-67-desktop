import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge, recordedCommandDetails } from "./pi67-renderer-fixture.js";
import { emitSessionCatalogChanged, installSessionCatalogFixture, updateSessionCatalogFixture } from "./pi67-session-catalog-fixture.js";

test("can explicitly start one new Session after an empty Catalog recovers beyond the opening budget", async ({ page }) => {
  await installMockDesktopBridge(page);
  await page.setViewportSize({ width: 679, height: 600 });
  await page.goto("/");
  await attachMockAgent(page);
  await installSessionCatalogFixture(page, { state: "rebuilding", rebuilding: true, items: [] });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.locator('[data-runtime-phase="stopped"]')).toBeVisible({ timeout: 7_000 });
  await expect(page.getByRole("button", { name: "新建对话", exact: true })).toBeEnabled();
  expect((await recordedCommandDetails(page)).some(command => command.type === "workspace.open")).toBe(false);

  // The synthetic Windows gate must not treat an unknown empty Catalog as ready.
  const readyEmpty = page.locator(
    '.application-shell[data-agent-connected="true"][data-workspace-open-pending="false"]'
    + ':has([data-runtime-phase="stopped"])'
    + ':has([data-testid="workspace-group"][data-catalog-state="ready"]'
    + '[data-catalog-loading="false"][data-catalog-rebuilding="false"]'
    + '[data-catalog-incomplete="false"][data-catalog-error="false"][data-catalog-item-count="0"])'
  ).getByRole("button", { name: "新建对话", exact: true });
  await expect(readyEmpty).toHaveCount(0);
  await updateSessionCatalogFixture(page, { revision: 2, state: "ready", rebuilding: false, items: [] });
  await emitSessionCatalogChanged(page, 2);
  await expect(readyEmpty).toBeVisible();
  await readyEmpty.click();
  await expect(page.getByTestId("new-session-intent")).toBeVisible();
  expect((await recordedCommandDetails(page)).some(command => command.type === "session.create")).toBe(false);

  await page.getByRole("textbox", { name: "给 Pi 发送消息" }).fill("目录恢复后的首条消息");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(async () => (await recordedCommandDetails(page))
    .filter(command => command.type === "prompt.submit")).toHaveLength(1);
  expect((await recordedCommandDetails(page)).filter(command => command.type === "session.create")).toHaveLength(1);
  expect((await recordedCommandDetails(page)).filter(command => command.type === "workspace.open")).toHaveLength(0);
});
