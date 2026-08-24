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
  for (const name of ["new", "model", "compact", "resume", "tree", "reload", "plan", "default", "settings"]) {
    await expect(picker.getByRole("option", { name: new RegExp(`/${name}\\b`, "u") })).toBeVisible();
  }
  await expect(picker.getByRole("option", { name: /\/plan/u })).toContainText("Pi 内置");
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

  await composer.fill("/plan");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "计划", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(composer).toHaveValue("");
  await expect.poll(() => scenarioCommandTypes(page)).toContain("session.interactionMode.set");
  expect((await scenarioCommandTypes(page)).filter((type) => (
    type === "command.invoke" || type === "prompt.submit"
  ))).toEqual([]);

  await composer.fill("/default");
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "执行", exact: true })).toHaveAttribute("aria-pressed", "true");
  await clearRecordedCommands(page);

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

test("groups Composer models by Provider without changing selected-row keyboard selection", async ({ page }) => {
  await page.setViewportSize({ width: 796, height: 756 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.fill("/model");
  await composer.press("Enter");

  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await expect(listbox.locator('[role="group"]')).toHaveCount(2);
  await expect(listbox.locator('[role="group"]').first()).toContainText("OpenAI");
  await expect(listbox.locator('[role="group"]').last()).toContainText("DeepSeek");
  await expect(listbox.getByRole("option")).toHaveCount(2);
  await expect(listbox.getByRole("option", { selected: true })).toBeFocused();
  await expect(listbox.getByRole("option", { selected: true })).toContainText("openai/gpt-test");
  await page.screenshot({
    path: "artifacts/visual-review/composer-model-provider-groups-dark.png",
    animations: "disabled"
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: "artifacts/visual-review/composer-model-provider-groups-light.png",
    animations: "disabled"
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await clearRecordedCommands(page);
  await page.keyboard.press("d");
  await expect(listbox.getByRole("option", { name: /DeepSeek V4 Flash/u })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(listbox.getByRole("option", { name: /GPT Test Extended/u })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(listbox.getByRole("option", { name: /DeepSeek V4 Flash/u })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["model.select"]);
  expect((await scenarioCommands(page))[0]?.payload).toMatchObject({
    provider: "deepseek",
    id: "deepseek-v4-flash"
  });
  await expect(listbox).toBeHidden();
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
