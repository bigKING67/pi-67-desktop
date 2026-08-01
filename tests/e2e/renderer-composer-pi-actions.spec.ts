import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  setMockAgentResponseFailure
} from "./pi67-renderer-fixture.js";
import {
  scenarioCommands,
  scenarioCommandTypes
} from "./pi67-renderer-scenario-commands.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("groups Pi Desktop actions and routes exact Enter without sending native actions to the model", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const composer = page.getByLabel("给 Pi 发送消息");
  const picker = page.getByTestId("composer-slash-picker");
  await composer.fill("/");
  await expect(picker).toBeVisible();
  for (const group of ["desktop-action", "extension", "prompt", "skill"]) {
    await expect(picker.locator(`#composer-slash-group-${group}`)).toBeVisible();
  }
  for (const name of ["new", "model", "compact", "resume", "tree", "reload", "settings"]) {
    await expect(picker.getByRole("option", { name: new RegExp(`/${name}\\b`, "u") })).toBeVisible();
  }
  await expect(picker.getByRole("option", { name: /\/plan/u })).toBeVisible();
  await page.screenshot({
    path: "artifacts/visual-review/composer-slash-desktop-actions.png",
    animations: "disabled"
  });
  await clearRecordedCommands(page);

  await composer.fill("/mo");
  await composer.press("Enter");
  await expect(composer).toHaveValue("/model ");
  expect(await scenarioCommandTypes(page)).toEqual([]);

  await composer.fill("/model");
  await composer.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(composer).toHaveValue("");
  expect(await scenarioCommandTypes(page)).toEqual([]);
  await page.keyboard.press("Escape");

  await composer.fill("/share");
  await composer.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "/share 是 Pi TUI 操作，当前 Desktop 尚未支持。" }))
    .toBeVisible();
  await expect(picker).toBeHidden();
  await expect(composer).toHaveValue("/share");
  expect(await scenarioCommandTypes(page)).toEqual([]);

  await composer.fill("/compact keep decisions");
  await composer.press("Enter");
  await expect.poll(() => scenarioCommandTypes(page)).toContain("session.compact");
  const compact = (await scenarioCommands(page)).find((command) => command.type === "session.compact");
  expect(compact?.payload).toMatchObject({ instructions: "keep decisions" });
  expect((await scenarioCommandTypes(page)).filter((type) => type === "prompt.submit")).toEqual([]);
});

test("keeps Desktop builtins available on Runtime catalog failure and blocks unsupported Pi TUI commands", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByLabel("给 Pi 发送消息")).toBeVisible();
  await setMockAgentResponseFailure(page, "command.list", {
    code: "INTERNAL",
    message: "fixture command catalog failure",
    recoverable: true
  });

  const composer = page.getByLabel("给 Pi 发送消息");
  await clearRecordedCommands(page);
  await composer.fill("/reload");
  await composer.press("Enter");
  await expect.poll(() => scenarioCommandTypes(page)).toContain("resource.reload");
  await expect(composer).toHaveValue("");

  await composer.fill("/");
  const picker = page.getByTestId("composer-slash-picker");
  await expect(picker.getByRole("option", { name: /\/new/u })).toBeVisible();
  await expect(picker.getByText("扩展命令、提示词与技能暂时无法加载；Pi 内置操作仍可使用。"))
    .toBeVisible();
  await clearRecordedCommands(page);

  await composer.fill("/share");
  await composer.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "/share 是 Pi TUI 操作，当前 Desktop 尚未支持。" }))
    .toBeVisible();
  await expect(picker).toBeHidden();
  await expect(composer).toHaveValue("/share");
  expect(await scenarioCommandTypes(page)).toEqual([]);

  await composer.fill("/unknown-compatible-command");
  await composer.press("Enter");
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["prompt.submit"]);
});
