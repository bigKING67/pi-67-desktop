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
    const streamMode = tools.querySelector<HTMLElement>('[aria-label^="运行中消息处理方式"]');
    const topmostSurface = (element: HTMLElement | null | undefined) => {
      if (!element) return "missing";
      const rect = element.getBoundingClientRect();
      const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (topmost === element || (topmost !== null && element.contains(topmost))) return "control";
      if (topmost?.closest(".context-pane")) return "context-pane";
      return topmost instanceof HTMLElement
        ? `${topmost.tagName.toLowerCase()}.${topmost.className}`
        : "none";
    };
    return {
      toolbarHeight: toolbarBox.height,
      toolbarRows: Math.min(toolsBox.bottom, actionsBox.bottom) > Math.max(toolsBox.top, actionsBox.top) ? 1 : 2,
      toolbarClientWidth: toolbar.clientWidth,
      toolbarScrollWidth: toolbar.scrollWidth,
      toolsClientWidth: tools.clientWidth,
      toolsScrollWidth: tools.scrollWidth,
      actionsClientWidth: actions.clientWidth,
      actionsScrollWidth: actions.scrollWidth,
      streamModeTopmost: topmostSurface(streamMode),
      sendTopmost: topmostSurface(send),
      stopTopmost: topmostSurface(stop),
      sendRight: send?.getBoundingClientRect().right ?? 0,
      stopRight: stop?.getBoundingClientRect().right ?? 0
    };
  });
}
