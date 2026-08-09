import type { Page } from "@playwright/test";

export function composerToolbarGeometry(page: Page) {
  return page.getByTestId("composer-region").evaluate((region) => {
    const toolbar = region.querySelector<HTMLElement>("[class*='_toolbar_']");
    const tools = toolbar?.children.item(0) as HTMLElement | null;
    const actions = toolbar?.children.item(1) as HTMLElement | null;
    const buttons = [...(actions?.querySelectorAll<HTMLElement>("button") ?? [])];
    const send = buttons.find((button) => button.textContent?.trim() === "发送");
    const stop = buttons.find((button) => button.textContent?.trim() === "停止");
    if (!toolbar || !tools || !actions) throw new Error("Composer toolbar geometry is unavailable.");
    const toolbarBox = toolbar.getBoundingClientRect();
    const toolsBox = tools.getBoundingClientRect();
    const actionsBox = actions.getBoundingClientRect();
    return {
      toolbarHeight: toolbarBox.height,
      toolbarRows: Math.min(toolsBox.bottom, actionsBox.bottom) > Math.max(toolsBox.top, actionsBox.top) ? 1 : 2,
      sendRight: send?.getBoundingClientRect().right ?? 0,
      stopRight: stop?.getBoundingClientRect().right ?? 0
    };
  });
}
