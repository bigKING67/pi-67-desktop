import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("normalizes HEIC as a removable JPEG and preserves the draft across a retryable decode failure", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.fill("保留这份 HEIC 草稿");
  await page.getByLabel("选择附件").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("note", "utf8")
  });
  await page.getByLabel("选择附件").setInputFiles({
    name: "fixture-decode-failure.heic",
    mimeType: "image/heic",
    buffer: Buffer.from("not-heic", "utf8")
  });

  await expect(composer).toHaveValue("保留这份 HEIC 草稿");
  await expect(page.getByRole("alert").filter({ hasText: "无法解码该 HEIC/HEIF 图片" })).toBeVisible();
  await expect(page.locator('[data-attachment-kind="document"]')).toContainText("notes.txt");
  await page.getByRole("button", { name: "移除附件：notes.txt" }).click();
  await expect(page.locator('[data-attachment-kind="document"]')).toHaveCount(0);

  await page.getByLabel("选择附件").setInputFiles({
    name: "camera.heic",
    mimeType: "image/heic",
    buffer: Buffer.from("fixture-heic", "utf8")
  });
  const normalized = page.locator('[data-attachment-kind="image"]');
  await expect(normalized).toContainText("camera.jpg");
  await expect(normalized).toContainText("图片 · 11 B");
  await expect(normalized.getByRole("img")).toHaveCount(0);
  await expect(composer).toHaveValue("保留这份 HEIC 草稿");
  await page.getByRole("button", { name: "移除附件：camera.jpg" }).click();
  await expect(normalized).toHaveCount(0);
});
