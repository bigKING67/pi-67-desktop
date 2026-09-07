import { expect } from "@playwright/test";

export async function configureRuntimeProvider(page, config) {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const palette = page.getByRole("dialog", { name: "命令面板", exact: true });
  await palette.getByLabel("搜索对话标题、正文、扩展命令和应用操作")
    .fill("模型服务与凭据");
  await palette.getByRole("option", { name: /模型服务与凭据/u }).click();
  const dialog = page.getByRole("dialog", { name: "Provider 与凭据", exact: true });
  await dialog.getByRole("textbox", { name: "搜索 Provider", exact: true }).fill(config.providerId);
  const escapedId = config.providerId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const provider = dialog.getByLabel("Pi Provider 列表").getByRole("button").filter({
    has: page.locator("small").filter({ hasText: new RegExp(`^${escapedId} · [0-9]+ 个模型$`, "u") })
  });
  await expect(provider).toHaveCount(1);
  await provider.click();
  await expect(provider).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator(".provider-credential-editor .provider-detail-heading small"))
    .toHaveText(config.providerId);
  const key = dialog.getByLabel("Provider API 密钥", { exact: true });
  await key.fill(config.apiKey);
  await dialog.getByRole("button", { name: "仅本次使用", exact: true }).click();
  await dialog.getByText("来源：当前运行内存（完全退出后失效）", { exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  await expect(key).toHaveValue("");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
}

export async function selectProviderModel(page, config) {
  const modelValue = `${config.providerId}/${config.modelId}`;
  const modelButton = page.getByRole("button", { name: "Pi 模型", exact: true });
  const modelList = page.locator('[role="listbox"][data-runtime-select="model"]');
  const model = modelList.getByRole("option").filter({
    has: page.getByText(modelValue, { exact: true })
  });
  await modelButton.click();
  await expect(model).toHaveCount(1);
  await model.click();
  await modelButton.click();
  await expect(model).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  const thinkingButton = page.getByRole("button", { name: "Pi 思考级别", exact: true });
  const thinking = page.locator('[role="listbox"][data-runtime-select="thinking"]')
    .getByRole("option", { name: config.thinkingLevel, exact: true });
  await thinkingButton.click();
  await thinking.click();
  await thinkingButton.click();
  await expect(thinking).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
}
