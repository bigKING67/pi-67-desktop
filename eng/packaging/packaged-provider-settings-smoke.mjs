export async function verifyPackagedProviderSettings({
  capturePackagedScreenshot,
  packagedCredential,
  window,
  workspaceSettings
}) {
  await workspaceSettings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "模型", exact: true }).click();
  const providerPanel = workspaceSettings.getByTestId("provider-configuration-panel");
  const providerSearch = providerPanel.getByRole("textbox", { name: "搜索 Pi Provider" });
  const providerList = providerPanel.getByTestId("provider-configuration-list");
  const providerEditor = providerPanel.getByTestId("provider-configuration-editor");
  await providerSearch.waitFor({ state: "visible", timeout: 15_000 });
  await providerList.waitFor({ state: "visible", timeout: 15_000 });
  if (await providerEditor.isVisible()) {
    throw new Error("Packaged Provider editor must not share the Provider Catalog surface.");
  }

  const providerCatalogTabs = providerPanel.getByRole("tablist", { name: "模型服务分类" });
  const availableProvidersTab = providerCatalogTabs.getByRole("tab", { name: /^可配置 \d+$/u });
  await availableProvidersTab.click();
  if ((await availableProvidersTab.getAttribute("aria-selected")) !== "true") {
    throw new Error("Packaged Provider Catalog did not switch to the configurable task view.");
  }
  await capturePackagedScreenshot(window, "01-provider-catalog.png");
  await verifySharedSettingsScroll({ providerList, workspaceSettings });

  const configuredProvidersTab = providerCatalogTabs.getByRole("tab", { name: /^已配置 \d+$/u });
  await configuredProvidersTab.click();
  await providerSearch.fill("anthropic");
  const providerRow = providerList.getByRole("button", { name: /^Anthropic\b/u });
  await providerRow.waitFor({ state: "visible", timeout: 15_000 });
  await providerRow.click();
  await providerEditor.waitFor({ state: "visible", timeout: 15_000 });
  await providerList.waitFor({ state: "hidden", timeout: 15_000 });
  await verifyProviderModelWorkspace({ capturePackagedScreenshot, providerPanel, window });
  await verifyProviderCredentialDialog({ packagedCredential, providerPanel, window, workspaceSettings });
}

async function verifySharedSettingsScroll({ providerList, workspaceSettings }) {
  const settingsScrollRegion = workspaceSettings.getByTestId("settings-scroll-region");
  const [providerListLayout, settingsScrollLayout] = await Promise.all([
    providerList.evaluate((element) => ({
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight
    })),
    settingsScrollRegion.evaluate((element) => ({
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight
    }))
  ]);
  if (
    providerListLayout.overflowY !== "visible"
    || settingsScrollLayout.overflowY !== "auto"
    || settingsScrollLayout.scrollHeight <= settingsScrollLayout.clientHeight
  ) {
    throw new Error(`Packaged Provider Catalog did not use the shared Settings scroll: ${JSON.stringify({
      providerList: providerListLayout,
      settings: settingsScrollLayout
    })}`);
  }
}

async function verifyProviderModelWorkspace({ capturePackagedScreenshot, providerPanel, window }) {
  const sectionTabs = providerPanel.getByRole("tablist", { name: "Provider 设置分区" });
  const modelTab = sectionTabs.getByRole("tab", { name: /^模型 \d+$/u });
  await modelTab.waitFor({ state: "visible", timeout: 15_000 });
  if ((await modelTab.getAttribute("aria-selected")) !== "true") {
    throw new Error("Packaged Provider workbench did not open on the model catalog.");
  }

  const modelList = providerPanel.getByTestId("provider-model-list");
  const modelRows = modelList.getByTestId("provider-model-row");
  const modelDetail = providerPanel.getByTestId("provider-model-detail");
  await modelList.waitFor({ state: "visible", timeout: 15_000 });
  await modelRows.first().waitFor({ state: "visible", timeout: 15_000 });
  if ((await modelRows.count()) < 1) throw new Error("Packaged Provider workbench rendered an empty model catalog.");
  if (await modelDetail.isVisible()) throw new Error("Packaged model detail must not share the model Catalog surface.");
  if ((await providerPanel.getByLabel("Model ID").count()) !== 0) {
    throw new Error("Packaged model Catalog mounted a detail editor before selection.");
  }
  await capturePackagedScreenshot(window, "02-model-catalog.png");

  await modelRows.first().click();
  await modelDetail.waitFor({ state: "visible", timeout: 15_000 });
  await modelList.waitFor({ state: "hidden", timeout: 15_000 });
  if ((await providerPanel.getByLabel("Model ID").count()) !== 1) {
    throw new Error("Packaged model detail did not render exactly one editor.");
  }
  await capturePackagedScreenshot(window, "03-model-detail.png");
  await providerPanel.getByRole("button", { name: "返回模型列表" }).click();
  await modelList.waitFor({ state: "visible", timeout: 15_000 });
}

async function verifyProviderCredentialDialog({ packagedCredential, window, workspaceSettings }) {
  await workspaceSettings.getByRole("button", { name: "更新 API Key", exact: true }).click();
  const dialog = window.getByRole("dialog", { name: "配置 Anthropic API Key" });
  await dialog.waitFor({ state: "visible", timeout: 15_000 });
  if (await dialog.getByLabel("Pi Provider 列表").count()) {
    throw new Error("Packaged targeted credential dialog rendered a second Provider picker.");
  }
  await dialog.getByText("已持久化到 Pi auth.json", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await dialog.getByRole("button", { name: "显示已保存 API Key（15 秒）" }).click();
  await dialog.getByText(packagedCredential, { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await dialog.getByRole("button", { name: "隐藏已保存 API Key" }).click();
  if (await dialog.getByText(packagedCredential, { exact: true }).count()) {
    throw new Error("Packaged credential reveal remained mounted after the user hid it.");
  }
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
}
