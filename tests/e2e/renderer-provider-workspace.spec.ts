import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommandDetails
} from "./pi67-renderer-fixture.js";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page, {
    initialWorkspaces: [DEFAULT_MOCK_WORKSPACE],
    currentWorkspaceId: DEFAULT_MOCK_WORKSPACE.id,
    expandedWorkspaceIds: [DEFAULT_MOCK_WORKSPACE.id],
    selectedSurface: { kind: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  });
});

test("persists a Provider credential from a registered Workspace without starting a Task", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^Provider 与模型/u }).click();
  await settings.getByRole("button", { name: "管理凭据", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Provider 与凭据" });
  await expect(dialog.getByText("OpenAI", { exact: true }).first()).toBeVisible();
  await dialog.getByRole("button", { name: /Anthropic/u }).click();
  const apiKeyInput = page.getByLabel("Provider API 密钥", { exact: true });
  await expect(apiKeyInput).toHaveAttribute("type", "password");
  await apiKeyInput.fill("workspace-secret-1234");
  await dialog.getByRole("button", { name: "显示 API Key" }).click();
  await expect(apiKeyInput).toHaveAttribute("type", "text");
  await expect(apiKeyInput).toHaveValue("workspace-secret-1234");
  await dialog.getByRole("button", { name: "隐藏 API Key" }).click();
  await expect(apiKeyInput).toHaveAttribute("type", "password");
  await dialog.getByRole("button", { name: "保存到 Pi" }).click();

  await expect(dialog.getByText("已持久化到 Pi auth.json")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("workspace-secret-1234");
  await dialog.getByRole("button", { name: "移除持久凭据" }).click();
  await expect(dialog.getByText("尚未配置")).toBeVisible();
  const commands = await recordedCommandDetails(page);
  expect(commands.filter((command) => command.type === "runtime.initialize")).toHaveLength(0);
  expect(commands).toContainEqual(expect.objectContaining({
    type: "provider.credential.store",
    payload: expect.objectContaining({ provider: "anthropic", apiKey: "[redacted]" }),
    context: { scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  }));
  expect(commands).toContainEqual(expect.objectContaining({
    type: "provider.credential.remove",
    payload: expect.objectContaining({ provider: "anthropic" }),
    context: { scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  }));
});

test("edits Pi Provider files, selects built-in defaults, and preserves a stale draft", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^Provider 与模型/u }).click();
  const panel = settings.getByTestId("provider-configuration-panel");
  const globalDefault = panel.getByLabel("全局默认");
  await expect(globalDefault.locator("option")).toContainText([
    "未设置",
    "OpenAI / GPT Test",
    "Anthropic / Claude Test"
  ]);

  await panel.getByRole("button", { name: "新建 Provider" }).click();
  await panel.getByLabel("Provider ID").fill("host-custom");
  await panel.getByLabel("显示名称").first().fill("Host Custom");
  await panel.getByLabel("Base URL").first().fill("https://example.invalid/v1");
  await panel.getByLabel("API 协议").fill("openai-responses");
  await panel.getByLabel("Header 名称").first().fill("X-Provider-Secret");
  await panel.getByLabel("Header 值").first().fill("provider-header-secret-value");
  await panel.getByRole("button", { name: "写入" }).first().click();

  await panel.getByRole("button", { name: "添加模型" }).click();
  await panel.getByLabel("Model ID").fill("fixture-model");
  await panel.getByLabel("显示名称").last().fill("Fixture Model");
  await panel.getByLabel("Context Window").fill("32768");
  await panel.getByLabel("Max Tokens").fill("4096");
  await panel.getByLabel("Header 名称").last().fill("X-Model-Secret");
  await panel.getByLabel("Header 值").last().fill("model-header-secret-value");
  await panel.getByRole("button", { name: "写入" }).last().click();
  await clearRecordedCommands(page);
  await panel.getByRole("button", { name: "保存到 Pi" }).click();

  await expect(panel.getByRole("button", { name: /Host Custom/u })).toBeVisible();
  const saveCommand = (await recordedCommandDetails(page)).find((command) => (
    command.type === "provider.configuration.save"
  ));
  expect(saveCommand).toMatchObject({
    context: { scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id },
    payload: {
      provider: {
        id: "host-custom",
        headers: [{ name: "X-Provider-Secret", value: "[redacted]" }],
        models: [expect.objectContaining({
          id: "fixture-model",
          headers: [{ name: "X-Model-Secret", value: "[redacted]" }]
        })]
      }
    }
  });
  expect(JSON.stringify(saveCommand)).not.toContain("provider-header-secret-value");
  expect(JSON.stringify(saveCommand)).not.toContain("model-header-secret-value");

  await globalDefault.selectOption({ label: "Host Custom / Fixture Model" });
  await expect(panel.getByText("host-custom / fixture-model", { exact: true })).toBeVisible();
  expect((await recordedCommandDetails(page)).some((command) => (
    command.type === "model.default.set"
    && (command.payload as Record<string, unknown>).provider === "host-custom"
  ))).toBe(true);

  await panel.getByLabel("显示名称").first().fill("Unsaved Local Name");
  const externalSnapshot = await page.evaluate(() => {
    const state = (window as typeof window & {
      __pi67TestAgent?: { providerConfiguration: Record<string, unknown> };
    }).__pi67TestAgent;
    if (!state) throw new Error("Missing Provider configuration fixture.");
    const snapshot = structuredClone(state.providerConfiguration) as Record<string, unknown>;
    snapshot.revision = "e".repeat(64);
    const providers = snapshot.providers as Array<Record<string, unknown>>;
    const provider = providers.find((candidate) => candidate.id === "host-custom");
    if (provider) provider.name = "Externally Updated Name";
    return snapshot;
  });
  await emitMockAgentEvent(page, {
    type: "provider.configuration.changed",
    payload: {
      snapshot: externalSnapshot,
      source: "external",
      changedFiles: ["models"],
      taskReload: "applied"
    }
  });

  await expect(panel.getByTestId("provider-configuration-conflict")).toBeVisible();
  await expect(panel.getByLabel("显示名称").first()).toHaveValue("Unsaved Local Name");
  await panel.getByRole("button", { name: "放弃草稿并采用最新配置" }).click();
  await expect(panel.getByTestId("provider-configuration-conflict")).toHaveCount(0);
  await expect(panel.getByLabel("显示名称").first()).toHaveValue("Externally Updated Name");
});
