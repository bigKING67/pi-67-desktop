export async function verifyPackagedLarkSettings({
  capturePackagedScreenshot,
  settingsNavigation,
  window,
  workspaceSettings
}) {
  await settingsNavigation.getByRole("button", { name: "飞书", exact: true }).click();
  const larkSettings = workspaceSettings.getByTestId("lark-office-settings");
  await larkSettings.waitFor({ state: "visible", timeout: 15_000 });
  const larkTabs = larkSettings.getByRole("tab");
  const larkTabLabels = (await larkTabs.allTextContents()).map((label) => label.trim());
  if (JSON.stringify(larkTabLabels) !== JSON.stringify(["用户授权", "应用配置"])) {
    throw new Error(`Packaged Lark Settings rendered the wrong Tab order: ${JSON.stringify(larkTabLabels)}.`);
  }

  const userTab = larkSettings.getByRole("tab", { name: "用户授权", exact: true });
  const applicationTab = larkSettings.getByRole("tab", { name: "应用配置", exact: true });
  if (await userTab.getAttribute("aria-selected") !== "true") {
    throw new Error("Packaged Lark Settings did not default to user authorization.");
  }
  await larkSettings.getByText("正在连接 Agent Host。", { exact: true })
    .waitFor({ state: "hidden", timeout: 30_000 });
  await window.waitForFunction(async () => {
    const state = await window.pi67.system.loadWorkbenchState();
    return state.settings.section === "lark" && state.settings.scope === "global";
  }, undefined, { timeout: 15_000 });
  if (await window.getByText("工作台布局未保存", { exact: true }).count()) {
    throw new Error("Packaged Lark Settings emitted a Workbench layout persistence failure.");
  }
  await capturePackagedScreenshot(window, "10-lark-user-authorization.png");

  await applicationTab.click();
  if (await applicationTab.getAttribute("aria-selected") !== "true") {
    throw new Error("Packaged Lark Settings did not switch to application configuration.");
  }
  await capturePackagedScreenshot(window, "10-lark-application-configuration.png");
}
