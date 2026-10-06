import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";
import { signIn } from "./pi67-team-chat-controls.js";
import type { MockTeamChatState } from "./pi67-team-chat-command-fixture.js";

/** A real 1×1 PNG, so the browser decodes what the timeline shows. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("uploads, sends, shows, opens and saves attachments, and refuses executables", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("group", { name: "工作模式" }).getByRole("button", { name: "聊天" }).click();
  await signIn(page);
  // A teammate's earlier image, read back through Agent Host in chunks.
  await page.evaluate((bytes) => {
    const state = (window as unknown as { __pi67MockTeamChat: MockTeamChatState }).__pi67MockTeamChat;
    const attachment = { id: "att-seed", fileName: "估值曲线.png", contentType: "image/png", byteSize: bytes.length, width: 640, height: 360 };
    state.files[attachment.id] = { attachment, bytes: new Uint8Array(bytes), received: bytes.length };
    const target = state.directory.conversations.find((item) => item.id === "conv-research")!;
    target.lastSeq += 1;
    state.messages["conv-research"]!.push({ id: "msg-image", conversationId: "conv-research", seq: target.lastSeq, senderUserId: "user-wang",
      body: "", clientKey: "seed-key-image", createdAt: Date.now(), attachments: [attachment] });
  }, [...PNG]);
  await page.getByTestId("team-chat-navigation").getByRole("button", { name: /^宏观研究/u }).click();
  const log = page.getByRole("log", { name: "#宏观研究" });
  const seeded = log.getByRole("button", { name: "查看图片 估值曲线.png" });
  await expect(seeded.locator("img")).toBeVisible();
  await expect(seeded).toHaveCSS("height", "180px");

  // Executables are refused before any upload; allowed files upload and fill the tray.
  const picker = page.locator("form input[type=file]");
  await picker.setInputFiles({ name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(page.getByText("setup.exe：不支持这种文件类型，可执行文件和脚本不能发送。")).toBeVisible();
  await picker.setInputFiles([
    { name: "截图.png", mimeType: "image/png", buffer: PNG },
    { name: "季度报告.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(1_500_000, 7) }
  ]);
  const tray = page.getByTestId("team-chat-attachment-tray");
  await expect(tray.getByRole("listitem")).toHaveCount(2);
  await expect(tray.getByText("1.4 MB")).toBeVisible();

  // Files alone make a message.
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(tray).toHaveCount(0);
  const sent = log.locator("article").filter({ has: page.getByTestId("team-chat-file-card") }).last();
  await expect(sent.getByRole("button", { name: "查看图片 截图.png" }).locator("img")).toBeVisible();
  await expect(sent.getByText("季度报告.pdf")).toBeVisible();
  const posted = await page.evaluate(() => {
    const state = (window as unknown as { __pi67MockTeamChat: MockTeamChatState }).__pi67MockTeamChat;
    const message = state.messages["conv-research"]!.at(-1)!;
    return { body: message.body, files: message.attachments?.map((item) => [item.fileName, item.byteSize]),
      pdfIntact: state.files[message.attachments![1]!.id]!.bytes.every((value) => value === 7) };
  });
  expect(posted).toEqual({ body: "", files: [["截图.png", PNG.length], ["季度报告.pdf", 1_500_000]], pdfIntact: true });

  // Save asks Main for a place; the whole file arrives in one piece.
  await sent.getByRole("button", { name: "保存 季度报告.pdf" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pi67SavedAttachments?: unknown[] }).__pi67SavedAttachments))
    .toEqual([{ fileName: "季度报告.pdf", byteLength: 1_500_000 }]);

  // Images open in a viewer that Escape closes.
  await seeded.click();
  const viewer = page.getByRole("dialog", { name: "估值曲线.png" });
  await expect(viewer.getByRole("img", { name: "估值曲线.png" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});
