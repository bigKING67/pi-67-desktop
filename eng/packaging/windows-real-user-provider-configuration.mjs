import { WINDOWS_REAL_USER_CONFIGURED_PROVIDER } from "./windows-real-user-profile.mjs";

export const REAL_USER_PROVIDER_TIMEOUT_MS = 10_000;

export async function verifyProviderConfiguration(window) {
  const startedAt = performance.now();
  await window.keyboard.press("Control+,");
  const settings = window.getByLabel("π 设置");
  await settings.waitFor({
    state: "visible",
    timeout: remainingTimeout(startedAt)
  });
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^模型服务/u })
    .click({ timeout: remainingTimeout(startedAt) });
  const panel = settings.getByTestId("provider-configuration-panel");
  const unavailable = settings.getByText("Pi 配置尚不可用", { exact: true });
  await panel.or(unavailable).waitFor({
    state: "visible",
    timeout: remainingTimeout(startedAt)
  });
  if (await unavailable.isVisible()) {
    throw new Error("Windows real-user Provider configuration became unavailable.");
  }
  await panel.getByRole("textbox", { name: "搜索 Pi Provider" }).waitFor({
    state: "visible",
    timeout: remainingTimeout(startedAt)
  });
  const configuredProvider = panel.getByRole("button", { name: /^OpenAI\b/u });
  await configuredProvider.waitFor({
    state: "visible",
    timeout: remainingTimeout(startedAt)
  });
  await configuredProvider.getByText("已配置", { exact: true }).waitFor({
    state: "visible",
    timeout: remainingTimeout(startedAt)
  });
  await configuredProvider.click({ timeout: remainingTimeout(startedAt) });
  await settings.getByRole("button", { name: "管理凭据", exact: true })
    .click({ timeout: remainingTimeout(startedAt) });
  const credentialDialog = window.getByRole("dialog", { name: "Provider 与凭据" });
  await credentialDialog.waitFor({
    state: "visible",
    timeout: remainingTimeout(startedAt)
  });
  await credentialDialog.getByText("已持久化到 Pi auth.json", { exact: true }).waitFor({
    state: "visible",
    timeout: remainingTimeout(startedAt)
  });
  await credentialDialog.getByRole("button", { name: "关闭", exact: true })
    .click({ timeout: remainingTimeout(startedAt) });
  await credentialDialog.waitFor({
    state: "hidden",
    timeout: remainingTimeout(startedAt)
  });
  await settings.getByRole("button", { name: "返回工作台", exact: true })
    .click({ timeout: remainingTimeout(startedAt) });
  await settings.waitFor({
    state: "hidden",
    timeout: remainingTimeout(startedAt)
  });
  const durationMs = performance.now() - startedAt;
  return {
    configuredProvider: WINDOWS_REAL_USER_CONFIGURED_PROVIDER,
    credentialPersistence: "pi-auth-json",
    durationMs: round(durationMs),
    outcome: "ready"
  };
}

function remainingTimeout(startedAt) {
  const remaining = Math.ceil(REAL_USER_PROVIDER_TIMEOUT_MS - (performance.now() - startedAt));
  if (remaining <= 0) {
    throw new Error(`Windows real-user Provider configuration exceeded ${REAL_USER_PROVIDER_TIMEOUT_MS}ms.`);
  }
  return remaining;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
