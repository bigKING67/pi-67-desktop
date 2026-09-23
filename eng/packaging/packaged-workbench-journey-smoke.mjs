import { expect } from "@playwright/test";

export async function verifyPackagedWorkbenchJourney({ window, captureScreenshot }) {
  const active = window.locator('[data-testid="conversation-row"][aria-current="page"]');
  const conversationId = await active.getAttribute("data-conversation-id");
  if (!conversationId) throw new Error("Workbench journey requires an active conversation.");
  const title = await active.locator("strong").getAttribute("title");
  if (!title) throw new Error("Workbench journey requires a conversation title.");
  const originalRow = window.getByTestId("conversation-row").filter({ has: window.getByTitle(title, { exact: true }) });
  await expect(originalRow).toHaveCount(1);
  const other = window.locator('[data-testid="conversation-row"]:not([aria-current="page"])').first();
  await expect(other).toBeVisible();
  const composer = window.getByLabel("给 Pi 发送消息");
  const draft = "原生验收草稿：切换对话和查看文件后应保留。";
  await composer.fill(draft);
  await other.click();
  await expect(active).not.toHaveAttribute("data-conversation-id", conversationId);
  await originalRow.click();
  await expect(composer).toHaveValue(draft);
  await captureScreenshot(window, "18-journey-restored-draft.png");

  const toggle = window.getByTestId("inspector-toggle");
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  const inspector = window.getByRole("complementary", { name: "任务检查器" });
  await inspector.getByRole("tab", { name: "文件", exact: true }).click();
  const file = inspector.getByRole("treeitem", { name: /^文件 AGENTS\.md /u });
  await file.click();
  const surface = window.getByRole("region", { name: "工作区文件与对话" });
  await expect(surface.getByRole("tab", { name: /AGENTS\.md$/u })).toBeVisible();
  await expect(window.locator(".cm-content")).toContainText("Packaged project context fixture.");
  await captureScreenshot(window, "19-journey-open-file.png");
  await surface.getByRole("tab", { name: "对话", exact: true }).click();
  await expect(composer).toHaveValue(draft);
  await expect(originalRow).toHaveAttribute("aria-current", "page");
  await composer.focus();
  await expect(composer).toBeFocused();
  await captureScreenshot(window, "20-journey-return-conversation.png");
  await surface.getByRole("button", { name: "关闭 AGENTS.md", exact: true }).click();
  await composer.fill("");
  console.info("Packaged workbench journey passed: conversation switching preserves draft; file opens and returns to the same conversation; Composer focus is usable.");
}
