import { join } from "node:path";
import { setPackagedContentSize } from "./packaged-electron-fixture.mjs";
import { openSettingsSection } from "./packaged-electron-smoke-scenarios.mjs";

export function createPackagedVisualEvidence(screenshotDirectory) {
  const capturePackagedScreenshot = async (window, fileName) => {
    if (!screenshotDirectory) return;
    await window.screenshot({ path: join(screenshotDirectory, fileName) });
  };

  const capturePackagedWorkbenchVisualEvidence = async (application, window) => {
    if (!screenshotDirectory) return;
    const conversation = window.getByLabel("Pi conversation");
    const composer = window.getByLabel("给 Pi 发送消息");
    await conversation.waitFor({ state: "visible", timeout: 15_000 });
    await capturePackagedScreenshot(window, "11-workbench-light.png");

    await composer.focus();
    await capturePackagedScreenshot(window, "12-composer-focus-light.png");
    await window.getByRole("button", { name: "打开命令面板" }).click();
    const commandPalette = window.getByRole("dialog", { name: "命令面板" });
    await commandPalette.waitFor({ state: "visible", timeout: 15_000 });
    await capturePackagedScreenshot(window, "13-command-palette-light.png");
    await window.keyboard.press("Escape");
    await commandPalette.waitFor({ state: "hidden", timeout: 15_000 });
    await window.mouse.move(720, 460);
    await window.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });

    await setPackagedContentSize(application, 1040, 720);
    await waitForTwoPaints(window);
    await capturePackagedScreenshot(window, "14-workbench-1040-light.png");
    await setPackagedContentSize(application, 760, 720);
    await waitForTwoPaints(window);
    await capturePackagedScreenshot(window, "15-workbench-760-light.png");
    await setPackagedContentSize(application, 1440, 920);
    await waitForTwoPaints(window);

    const darkSettings = await openSettingsSection(window, /^外观/u);
    await darkSettings.getByRole("button", { name: /^深色/u }).click();
    await window.locator('html[data-theme-preference="dark"][data-theme="dark"]').waitFor({ state: "attached" });
    await capturePackagedScreenshot(window, "16-appearance-dark.png");
    await darkSettings.getByRole("button", { name: "返回工作台" }).click();
    await darkSettings.waitFor({ state: "hidden", timeout: 15_000 });
    await conversation.waitFor({ state: "visible", timeout: 15_000 });
    await capturePackagedScreenshot(window, "17-workbench-dark.png");

    const lightSettings = await openSettingsSection(window, /^外观/u);
    await lightSettings.getByRole("button", { name: /^浅色/u }).click();
    await window.locator('html[data-theme-preference="light"][data-theme="light"]').waitFor({ state: "attached" });
    await lightSettings.getByRole("button", { name: "返回工作台" }).click();
    await lightSettings.waitFor({ state: "hidden", timeout: 15_000 });
    await conversation.waitFor({ state: "visible", timeout: 15_000 });
  };

  return { capturePackagedScreenshot, capturePackagedWorkbenchVisualEvidence };
}

async function waitForTwoPaints(window) {
  await window.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}
