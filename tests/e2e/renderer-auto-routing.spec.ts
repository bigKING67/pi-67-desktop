import { expect, test } from "@playwright/test";
import type { AutoRoutingPart } from "../../packages/domain/src/index.js";
import { attachMockAgent, clearRecordedCommands, createMockProviderConfigurationSnapshot,
  installMockDesktopBridge, recordedCommandDetails } from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => { await installMockDesktopBridge(page); });

test("offers Auto in a new task and preserves the explicit choice when its settings are disabled", async ({ page }) => {
  const snapshot = createMockProviderConfigurationSnapshot();
  snapshot.providers[1]!.configured = true;
  snapshot.autoRouting = { judge: { provider: "openai", model: "gpt-test" }, standard: { provider: "openai", model: "gpt-test" }, complex: { provider: "anthropic", model: "claude-test" } };
  await page.goto("/");
  await attachMockAgent(page, [], {}, { providerConfigurationSnapshot: snapshot });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("button", { name: "在 pi-demo 新建对话" }).click();
  const picker = page.getByRole("button", { name: "Pi 模型", exact: true });
  await picker.click();
  await page.getByRole("listbox").getByRole("option", { name: /Auto · 自动选择/u }).click();
  await expect(picker).toContainText("Auto · 自动选择");
  await page.keyboard.press("Control+,");
  const settings = page.getByLabel("New Money 设置");
  await settings.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "模型", exact: true }).click();
  await settings.getByTestId("auto-routing-settings").getByRole("button", { name: "关闭 Auto" }).click();
  await expect(settings.getByRole("button", { name: "关闭 Auto" })).toHaveCount(0);
  await settings.getByRole("button", { name: "返回工作台", exact: true }).click();
  await expect(picker).toContainText("Auto · 配置不可用");
  await picker.click();
  await expect(page.getByText("Auto 配置不可用。请更新配置或明确选择其他模型。", { exact: true })).toBeVisible();
});

test("configures opt-in Auto with exact candidates, keeps the default and can disable it", async ({ page }, testInfo) => {
  const snapshot = createMockProviderConfigurationSnapshot();
  snapshot.providers[1]!.configured = true;
  await page.goto("/");
  await attachMockAgent(page, [], {}, { providerConfigurationSnapshot: snapshot });
  await page.keyboard.press("Control+,");
  const settings = page.getByLabel("New Money 设置");
  await settings.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "模型", exact: true }).click();
  const form = settings.getByTestId("auto-routing-settings");
  await expect(form).toBeVisible();
  await expect(form.getByRole("button", { name: "保存 Auto 配置" })).toBeDisabled();
  for (const [role, option] of [["判断模型", "OpenAI / GPT Test"], ["常规任务", "OpenAI / GPT Test"], ["复杂任务", "Anthropic / Claude Test"]] as const) {
    await form.getByRole("button", { name: new RegExp(`Auto ${role}$`, "u") }).click();
    await page.getByRole("listbox", { name: `Auto ${role}` }).getByRole("option", { name: option, exact: true }).click();
  }
  await clearRecordedCommands(page);
  await form.getByRole("button", { name: "保存 Auto 配置" }).click();
  await expect(form.getByRole("button", { name: "保存 Auto 配置" })).toBeDisabled();
  await expect(form.getByRole("button", { name: "关闭 Auto" })).toBeVisible();
  const commands = await recordedCommandDetails(page);
  expect(commands.filter((command) => command.type === "model.routing.global.set")).toHaveLength(1);
  expect(commands).toContainEqual(expect.objectContaining({ type: "model.routing.global.set", context: { scope: "app" },
    payload: { expectedRevision: snapshot.revision, selection: {
      judge: { provider: "openai", model: "gpt-test" }, standard: { provider: "openai", model: "gpt-test" }, complex: { provider: "anthropic", model: "claude-test" }
    } } }));
  expect(commands.some((command) => command.type === "model.default.set")).toBe(false);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await form.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`auto-settings-${colorScheme}.png`), animations: "disabled" });
  }
  await form.getByRole("button", { name: "关闭 Auto" }).click();
  await expect(form.getByRole("button", { name: "关闭 Auto" })).toHaveCount(0);
});

test("keeps unavailable saved models explicit and permits turning Auto off", async ({ page }) => {
  const snapshot = createMockProviderConfigurationSnapshot();
  snapshot.autoRouting = { judge: { provider: "missing", model: "judge" }, standard: { provider: "openai", model: "gpt-test" }, complex: { provider: "anthropic", model: "claude-test" } };
  await page.goto("/");
  await attachMockAgent(page, [], {}, { providerConfigurationSnapshot: snapshot });
  await page.keyboard.press("Control+,");
  await page.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "模型", exact: true }).click();
  const form = page.getByTestId("auto-routing-settings");
  await expect(form.getByRole("button", { name: /不可用 · missing \/ judge Auto 判断模型/u })).toBeVisible();
  await expect(form.getByRole("button", { name: "保存 Auto 配置" })).toBeDisabled();
  await form.getByRole("button", { name: /Auto 判断模型$/u }).click();
  await expect(page.getByRole("option", { name: "不可用 · missing / judge" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await form.getByRole("button", { name: "关闭 Auto" }).click();
  await expect(form.getByRole("button", { name: "关闭 Auto" })).toHaveCount(0);
});

test("shows persisted Auto choices and failure facts without claiming task completion", async ({ page }) => {
  await page.goto("/");
  const decision: AutoRoutingPart = { type: "auto-routing", status: "selected", reason: "complex",
    judge: { provider: "fixture", model: "judge" }, selected: { provider: "fixture", model: "deep" }, inputTruncated: true, totalTokens: 35, totalCost: 0.002 };
  await attachMockAgent(page, [{ id: "decision", role: "system", parts: [decision] }]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  const card = page.getByTestId("auto-routing-evidence");
  await expect(card).toBeVisible();
  await expect(card.getByText(/fixture \/ deep/u)).toBeVisible();
  await card.locator("summary").click();
  await expect(card.getByText(/判断用量：35 tokens/u)).toBeVisible();
  await expect(card.getByText(/前 16,000 个字符/u)).toBeVisible();
});
