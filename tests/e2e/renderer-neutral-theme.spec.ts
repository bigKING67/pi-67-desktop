import { expect, test, type Locator } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";

function channels(color: string): number[] {
  if (color.startsWith("#")) return [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
  return color.match(/[\d.]+/gu)!.slice(0, 3).map(Number);
}

function luminance(color: string): number {
  return channels(color).reduce((sum, value, index) => {
    const component = value / 255;
    const linear = component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index]!;
  }, 0);
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

function expectNeutral(color: string): void {
  const rgb = channels(color);
  expect(Math.max(...rgb) - Math.min(...rgb), color).toBeLessThanOrEqual(1);
}

async function appearance(locator: Locator) {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return { foreground: style.color, background: style.backgroundColor };
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`neutral ${theme} surfaces keep readable text and primary actions across theme changes`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await installMockDesktopBridge(page);
    await page.goto("/");
    await attachMockAgent(page, [
      { id: "theme-user", role: "user", parts: [{ type: "text", text: "请整理本周进展和下一步。" }] },
      { id: "theme-answer", role: "assistant", parts: [{ type: "text", text: "**进展**：登录页联调完成。\n\n**下一步**：确认字段口径，完成报表导出测试。" }] }
    ]);
    await page.getByRole("button", { name: "选择工作区" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator('[data-message-id="theme-answer"]')).toBeVisible();

    const palette = await page.locator("html").evaluate((root) => {
      const names = ["canvas", "surface", "surface-muted", "surface-raised", "surface-hover",
        "surface-active", "border", "border-strong", "text-primary", "text-secondary",
        "text-tertiary", "accent", "accent-strong", "accent-soft", "success", "danger"];
      const style = getComputedStyle(root);
      return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(`--${name}`).trim()]));
    });
    for (const [role, color] of Object.entries(palette)) {
      if (role !== "success" && role !== "danger") expectNeutral(color);
    }
    for (const surface of ["canvas", "surface", "surface-muted", "surface-raised", "surface-hover", "surface-active"]) {
      for (const text of ["text-primary", "text-secondary", "text-tertiary"]) {
        expect(contrast(palette[text]!, palette[surface]!), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(channels(palette.success!)[1]).toBeGreaterThan(channels(palette.success!)[0]!);
    expect(channels(palette.danger!)[0]).toBeGreaterThan(channels(palette.danger!)[1]!);

    const composer = page.getByLabel("给 Pi 发送消息");
    const send = page.getByRole("button", { name: "发送", exact: true });
    await expect(send).toBeDisabled();
    await composer.fill("检查深色主题的阅读和操作层次");
    await expect(send).toBeEnabled();
    const idle = await appearance(send);
    expectNeutral(idle.background);
    expect(contrast(idle.foreground, idle.background)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(idle.background) > luminance(idle.foreground)).toBe(theme === "dark");
    await send.hover();
    await expect(send).toHaveCSS("background-color", `rgb(${channels(palette["accent-strong"]!).join(", ")})`);
    const hovered = await appearance(send);
    expect(hovered.background).not.toBe(idle.background);
    expect(contrast(hovered.foreground, hovered.background)).toBeGreaterThanOrEqual(4.5);
    await composer.focus();
    await page.screenshot({ path: testInfo.outputPath(`neutral-${theme}-composer.png`), animations: "disabled" });

    await page.getByRole("button", { name: "帮助与设置" }).click();
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();
    const settings = page.getByTestId("settings-workbench");
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "外观", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`neutral-${theme}-settings.png`), animations: "disabled" });
    const opposite = theme === "dark" ? "light" : "dark";
    await page.emulateMedia({ colorScheme: opposite });
    await expect(page.locator("html")).toHaveAttribute("data-theme", opposite);
    await settings.getByRole("button", { name: theme === "dark" ? "深色" : "浅色", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme-preference", theme);
  });
}
