import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  setMockAgentResponseFailure,
  type FixtureMessage
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("keeps failed create input and focus with a localized inline error", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [userMessage("message-1", "Create a duplicate")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await setMockAgentResponseFailure(page, "workspace.file.create", {
    code: "RESOURCE_CHANGED_EXTERNALLY",
    message: "目标名称已存在。",
    recoverable: false
  });
  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await inspector.getByRole("button", { name: "新建工作区项目" }).click();
  await page.getByRole("menuitem", { name: "新建文件", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建文件" });
  const input = dialog.getByRole("textbox", { name: "文件名称" });
  await input.fill("README.md");
  await dialog.getByRole("button", { name: "创建" }).click();
  await expect(dialog.getByText("此位置已经存在同名文件或文件夹。")).toBeVisible();
  await expect(input).toHaveValue("README.md");
  await expect(input).toBeFocused();
});

test("keeps the naming dialog padded and contained in dark narrow windows", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 640, height: 620 });
  await page.goto("/");
  await attachMockAgent(page, [userMessage("message-1", "Inspect narrow layout")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("button", { name: "显示任务检查器" }).click();
  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await inspector.getByRole("button", { name: "新建工作区项目" }).click();
  await page.getByRole("menuitem", { name: "新建文件", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建文件" });
  await testInfo.attach("workspace-create-file-dark-narrow", {
    body: await dialog.screenshot(),
    contentType: "image/png"
  });
  const metrics = await dialog.evaluate((element) => {
    const form = element.querySelector("form");
    const input = element.querySelector("input");
    const modal = element.closest<HTMLElement>(".workspace-file-name-modal");
    const modalBox = modal?.getBoundingClientRect();
    const inputBox = input?.getBoundingClientRect();
    return {
      padding: form ? Number.parseFloat(getComputedStyle(form).paddingLeft) : 0,
      modalLeft: modalBox?.left ?? 0,
      modalRight: modalBox?.right ?? 0,
      inputLeft: inputBox?.left ?? 0,
      inputRight: inputBox?.right ?? 0,
      background: modal ? getComputedStyle(modal).backgroundColor : ""
    };
  });
  expect(metrics.padding).toBeGreaterThanOrEqual(20);
  expect(metrics.modalLeft).toBeGreaterThanOrEqual(12);
  expect(metrics.modalRight).toBeLessThanOrEqual(628);
  expect(metrics.inputLeft - metrics.modalLeft).toBeGreaterThanOrEqual(20);
  expect(metrics.modalRight - metrics.inputRight).toBeGreaterThanOrEqual(20);
  expect(metrics.background).not.toBe("rgb(255, 255, 255)");
});

function userMessage(id: string, text: string): FixtureMessage {
  return {
    id,
    role: "user",
    createdAt: 1,
    parts: [{ type: "text", text }]
  };
}
