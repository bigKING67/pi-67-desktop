import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommands,
  type FixtureMessage
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("reveals Workspace files and opens one deduplicated Pi-67 editor tab", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [userMessage("message-1", "Inspect the workspace")]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("tab", { name: "文件" })).toHaveAttribute("aria-selected", "true");
  const readmeRow = inspector.getByRole("button", { name: "README.md 24 B", exact: true });
  await expect(readmeRow).toBeVisible();
  const typeMetrics = await inspector.evaluate((element) => {
    const fontSize = (selector: string) => {
      const candidate = element.querySelector<HTMLElement>(selector);
      return candidate ? Number.parseFloat(getComputedStyle(candidate).fontSize) : 0;
    };
    return {
      tab: fontSize('[role="tab"]'),
      search: fontSize(".inspector-search input"),
      fileName: fontSize(".inspector-file-name"),
      fileMetadata: fontSize(".inspector-file-row small")
    };
  });
  expect(typeMetrics.tab).toBeGreaterThanOrEqual(12);
  expect(typeMetrics.search).toBeGreaterThanOrEqual(12);
  expect(typeMetrics.fileName).toBeGreaterThanOrEqual(12);
  expect(typeMetrics.fileMetadata).toBeGreaterThanOrEqual(10);

  const workspaceEmphasis = await page.getByTestId("workspace-group").evaluate((group) => {
    const header = group.querySelector("header");
    return {
      group: getComputedStyle(group).backgroundColor,
      header: header ? getComputedStyle(header).backgroundColor : ""
    };
  });
  expect(workspaceEmphasis.group).toBe("rgba(0, 0, 0, 0)");
  expect(workspaceEmphasis.header).not.toBe(workspaceEmphasis.group);

  await readmeRow.click();
  await expect.poll(async () => page.evaluate(() => (
    window as unknown as { __pi67WorkspaceEntryTest: { reveals: Array<{ relativePath: string }> } }
  ).__pi67WorkspaceEntryTest.reveals.map((entry) => entry.relativePath))).toEqual(["README.md"]);
  expect(await recordedCommands(page)).not.toContain("workspace.file.open");

  await readmeRow.click({ button: "right" });
  const fileSurface = page.getByRole("region", { name: "工作区文件与对话" });
  await expect(fileSurface.getByRole("tab", { name: "对话", exact: true })).toBeVisible();
  await expect(fileSurface.getByRole("tab", { name: "README.md", exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("# Fixture workspace");
  await expect.poll(async () => (await recordedCommands(page)).filter((type) => type === "workspace.file.open").length).toBe(1);

  await readmeRow.click({ button: "right" });
  await expect.poll(async () => (await recordedCommands(page)).filter((type) => type === "workspace.file.open").length).toBe(1);
  await expect(fileSurface.getByRole("tab", { name: "README.md", exact: true })).toHaveCount(1);

  await page.locator(".cm-content").fill("# Fixture workspace\nUpdated in Pi-67\n");
  await expect(fileSurface.getByLabel("未保存")).toBeVisible();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
  await expect.poll(async () => (await recordedCommands(page)).filter((type) => type === "workspace.file.save").length).toBe(1);
  await expect(fileSurface.getByLabel("未保存")).toHaveCount(0);

  const search = inspector.getByRole("textbox", { name: "搜索工作区文件" });
  await search.fill("main");
  await search.press("Enter");
  await expect(inspector.getByRole("button", { name: "main.ts 42 B", exact: true })).toBeVisible();
});

test("opens safe transcript Workspace links and keeps unsupported targets inert", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "assistant-workspace-links",
    role: "assistant",
    parts: [{
      type: "text",
      text: [
        "[README source](./README.md#L4)",
        "[escape](../outside.md)",
        "[active](javascript:alert(1))"
      ].join(" ")
    }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  const message = page.locator('[data-message-id="assistant-workspace-links"]');
  await expect(message.getByRole("link", { name: "README source" })).toBeVisible();
  await expect(message.getByRole("link", { name: "escape" })).toHaveCount(0);
  await expect(message.getByRole("link", { name: "active" })).toHaveCount(0);
  await message.getByText("escape", { exact: true }).click();
  await message.getByText("active", { exact: true }).click();
  expect((await recordedCommands(page)).filter((type) => (
    type === "workspace.file.resolve" || type === "workspace.file.open"
  ))).toEqual([]);

  await message.getByRole("link", { name: "README source" }).click();
  const fileSurface = page.getByRole("region", { name: "工作区文件与对话" });
  await expect(fileSurface.getByRole("tab", { name: "README.md", exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("# Fixture workspace");
  await expect.poll(async () => (await recordedCommands(page)).filter((type) => (
    type === "workspace.file.resolve" || type === "workspace.file.open"
  ))).toEqual(["workspace.file.resolve", "workspace.file.open"]);
});

test("indexes only user messages and jumps to an unloaded historical window", async ({ page }) => {
  const messages = Array.from({ length: 150 }, (_, index) => userMessage(
    `user-${index}`,
    `User request ${index}`,
    index + 1
  ));
  await page.goto("/");
  await attachMockAgent(page, messages);
  await page.getByRole("button", { name: "选择工作区" }).click();
  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await inspector.getByRole("tab", { name: "消息" }).click();

  await expect(inspector.getByText("150 条用户消息", { exact: true })).toBeVisible();
  await expect(inspector.getByText("User request 149", { exact: true })).toBeVisible();
  await inspector.getByRole("button", { name: /更早/u }).click();
  const firstMessage = inspector.getByRole("listitem").filter({ hasText: "User request 0" });
  await expect(firstMessage).toBeVisible();
  await firstMessage.click();

  const transcript = page.locator('[data-transcript-region="true"]');
  await expect(transcript).toHaveAttribute("data-historical-window", "true");
  const target = transcript.locator('[data-message-id="user-0"]');
  await expect(target).toBeVisible();
  await expect(target).toBeFocused();
  await expect(target).toHaveAttribute("data-highlighted", "true");
  await transcript.getByRole("button", { name: "回到最新消息" }).click();
  await expect(transcript).toHaveAttribute("data-historical-window", "false");
  await expect(page.getByText("User request 149", { exact: true }).last()).toBeVisible();
});

test("opens Session branching as a dedicated dialog through /tree", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [userMessage("message-1", "Open the tree")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.fill("/tree");
  await composer.press("Enter");

  await expect(page.getByRole("dialog", { name: "会话分支与回退" })).toBeVisible();
  await expect(composer).toHaveValue("");
});

function userMessage(id: string, text: string, createdAt = 1): FixtureMessage {
  return {
    id,
    role: "user",
    createdAt,
    parts: [{ type: "text", text }]
  };
}
