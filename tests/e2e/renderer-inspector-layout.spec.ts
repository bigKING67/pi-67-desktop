import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  waitForMockWorkspaceReady
} from "./pi67-renderer-fixture.js";

test("keeps all five Inspector icon-label tabs equal, visible, and single-line", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1_600, height: 900 });
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);

  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  const inspectorToggle = page.getByTestId("inspector-toggle");
  if (await inspectorToggle.getAttribute("aria-expanded") === "false") {
    await inspectorToggle.click();
  }
  await expect(inspectorToggle).toHaveAttribute("aria-expanded", "true");
  await expect(inspector).toBeVisible();
  await expect(page.getByTestId("composer-region")).toBeVisible();
  const tabList = inspector.getByRole("tablist", { name: "任务检查器" });
  const tabs = tabList.getByRole("tab");
  await expect(tabs).toHaveCount(5);
  await expect(tabs).toHaveText(["文件", "修改", "消息", "代理", "上下文"]);

  const scaleCases = [
    { scale: 1, width: 1_600, height: 900 },
    { scale: 1.25, width: 1_280, height: 720 },
    { scale: 1.5, width: 1_067, height: 600 },
    { scale: 2, width: 800, height: 450 }
  ] as const;
  let previousWidth = 1_600;
  for (const scaleCase of scaleCases) {
    await page.setViewportSize({ width: scaleCase.width, height: scaleCase.height });
    if (previousWidth > 1_320 && scaleCase.width <= 1_320) {
      await expect(inspectorToggle).toHaveAttribute("aria-expanded", "false");
    }
    if (await inspectorToggle.getAttribute("aria-expanded") === "false") {
      await inspectorToggle.click();
    }
    await expect(inspectorToggle).toHaveAttribute("aria-expanded", "true");
    await expect(inspector).toBeVisible();
    const geometry = await tabList.evaluate((element) => {
      const tabElements = [...element.querySelectorAll<HTMLElement>('[role="tab"]')];
      const listRect = element.getBoundingClientRect();
      const root = document.documentElement;
      const inspectorElement = element.closest<HTMLElement>(".context-pane");
      const composer = document.querySelector<HTMLElement>('[data-testid="composer-region"]');
      return {
        listClientWidth: element.clientWidth,
        listScrollWidth: element.scrollWidth,
        listRect: { left: listRect.left, right: listRect.right },
        rootClientWidth: root.clientWidth,
        rootScrollWidth: root.scrollWidth,
        inspectorOwnsComposerOverlap: (() => {
          if (!inspectorElement || !composer) return false;
          const inspectorRect = inspectorElement.getBoundingClientRect();
          const composerRect = composer.getBoundingClientRect();
          const left = Math.max(inspectorRect.left, composerRect.left);
          const right = Math.min(inspectorRect.right, composerRect.right);
          const top = Math.max(inspectorRect.top, composerRect.top);
          const bottom = Math.min(inspectorRect.bottom, composerRect.bottom);
          if (right <= left || bottom <= top) return true;
          const topElement = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
          return topElement !== null && inspectorElement.contains(topElement);
        })(),
        tabs: tabElements.map((tab) => {
          const rect = tab.getBoundingClientRect();
          const icon = tab.querySelector<SVGElement>(".context-pane-tab-icon");
          const label = tab.querySelector<HTMLElement>("span");
          const iconRect = icon?.getBoundingClientRect();
          const labelRect = label?.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            scrollHeight: tab.scrollHeight,
            clientHeight: tab.clientHeight,
            iconVisible: icon !== null && getComputedStyle(icon).display !== "none"
              && (iconRect?.width ?? 0) > 0 && (iconRect?.height ?? 0) > 0,
            labelVisible: label !== null && getComputedStyle(label).display !== "none"
              && (labelRect?.width ?? 0) > 0 && (labelRect?.height ?? 0) > 0
          };
        })
      };
    });
    expect(geometry.listScrollWidth).toBeLessThanOrEqual(geometry.listClientWidth + 1);
    expect(geometry.listRect.left).toBeGreaterThanOrEqual(0);
    expect(geometry.listRect.right).toBeLessThanOrEqual(scaleCase.width + 1);
    expect(geometry.rootScrollWidth).toBeLessThanOrEqual(geometry.rootClientWidth + 1);
    expect(
      geometry.inspectorOwnsComposerOverlap,
      `Inspector must own any Composer overlap at ${scaleCase.scale * 100}% scale.`
    ).toBe(true);
    const widths = geometry.tabs.map((tab) => tab.width);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    for (const tab of geometry.tabs) {
      expect(tab.iconVisible).toBe(true);
      expect(tab.labelVisible).toBe(true);
      expect(tab.scrollHeight).toBeLessThanOrEqual(tab.clientHeight + 1);
    }
    previousWidth = scaleCase.width;
  }

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await testInfo.attach("inspector-tabs-200-percent-light.png", {
    body: await inspector.screenshot(),
    contentType: "image/png"
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(tabs).toHaveText(["文件", "修改", "消息", "代理", "上下文"]);
  await testInfo.attach("inspector-tabs-200-percent-dark.png", {
    body: await inspector.screenshot(),
    contentType: "image/png"
  });

  await page.setViewportSize({ width: 1_120, height: 800 });
  await expect(inspector).toBeVisible();
  const drawerGeometry = await inspector.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const root = document.documentElement;
    return {
      position: getComputedStyle(element).position,
      width: rect.width,
      right: rect.right,
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth
    };
  });
  expect(drawerGeometry.position).toBe("fixed");
  expect(drawerGeometry.width).toBeGreaterThanOrEqual(359);
  expect(drawerGeometry.right).toBeLessThanOrEqual(1_121);
  expect(drawerGeometry.rootScrollWidth).toBeLessThanOrEqual(drawerGeometry.rootClientWidth + 1);
});
