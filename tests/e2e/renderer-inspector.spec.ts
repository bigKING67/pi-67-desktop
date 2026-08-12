import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommandDetails,
  recordedCommands,
  setMockAgentResponseFailure,
  type FixtureMessage
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("opens Workspace files directly and keeps tree, search, and toolbar semantics usable", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page, [userMessage("message-1", "Inspect the workspace")]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("tab", { name: "文件" })).toHaveAttribute("aria-selected", "true");
  const tree = inspector.getByRole("tree", { name: "工作区文件" });
  const readmeRow = tree.getByRole("treeitem", { name: "文件 README.md 24 B", exact: true });
  await expect(readmeRow).toBeVisible();
  await expect(readmeRow).toHaveAttribute("aria-level", "1");
  const srcRow = tree.getByRole("treeitem", { name: "文件夹 src", exact: true });
  await expect(tree.getByRole("treeitem", { name: "文件夹 node_modules", exact: true })).toHaveCount(0);
  await srcRow.focus();
  await srcRow.press("ArrowRight");
  await expect(srcRow).toHaveAttribute("aria-expanded", "true");
  const indexRow = tree.getByRole("treeitem", { name: "文件 index.ts 18 B", exact: true });
  const mainRow = tree.getByRole("treeitem", { name: "文件 main.ts 42 B", exact: true });
  await expect(mainRow).toHaveAttribute("aria-level", "2");
  await srcRow.press("ArrowRight");
  await expect(indexRow).toBeFocused();
  await indexRow.press("ArrowLeft");
  await expect(srcRow).toBeFocused();
  await srcRow.press("ArrowLeft");
  await expect(srcRow).toHaveAttribute("aria-expanded", "false");
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
  const fileSurface = page.getByRole("region", { name: "工作区文件与对话" });
  await expect(fileSurface.getByRole("tab", { name: "对话", exact: true })).toBeVisible();
  await expect(fileSurface.getByRole("tab", { name: /README\.md$/u })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("# Fixture workspace");
  await expect.poll(async () => (await recordedCommands(page)).filter((type) => type === "workspace.file.open").length).toBe(1);
  expect(await page.evaluate(() => (
    window as unknown as { __pi67WorkspaceEntryTest: { reveals: unknown[] } }
  ).__pi67WorkspaceEntryTest.reveals)).toEqual([]);

  await readmeRow.click({ button: "right" });
  await expect.poll(async () => (await recordedCommands(page)).filter((type) => type === "workspace.file.open").length).toBe(1);
  await expect(fileSurface.getByRole("tab", { name: "README.md", exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => (
    window as unknown as { __pi67WorkspaceEntryTest: { menuManagement: boolean[] } }
  ).__pi67WorkspaceEntryTest.menuManagement.at(-1))).toBe(true);

  await srcRow.press("ArrowRight");
  await expect(srcRow).toHaveAttribute("aria-expanded", "true");
  await mainRow.click();
  await inspector.getByRole("button", { name: "刷新文件" }).click();
  await expect(srcRow).toHaveAttribute("aria-expanded", "true");
  await expect(mainRow).toHaveAttribute("aria-selected", "true");

  await page.locator(".cm-content").fill("# Fixture workspace\nUpdated in Pi-67\n");
  await expect(fileSurface.getByLabel("未保存")).toBeVisible();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
  await expect.poll(async () => (await recordedCommands(page)).filter((type) => type === "workspace.file.save").length).toBe(1);
  await expect(fileSurface.getByLabel("未保存")).toHaveCount(0);

  const search = inspector.getByRole("textbox", { name: "搜索工作区文件" });
  await search.fill("index");
  await search.press("Enter");
  const searchTree = inspector.getByRole("tree", { name: "工作区文件搜索结果" });
  await expect(searchTree.getByText("src/index.ts", { exact: true })).toBeVisible();
  await expect(searchTree.getByText("tests/index.ts", { exact: true })).toBeVisible();
  await expect(searchTree.getByText("node_modules/dependency/index.ts", { exact: true })).toHaveCount(0);
  await inspector.getByRole("checkbox", { name: "显示依赖/生成目录" }).check();
  await expect(searchTree.getByText("node_modules/dependency/index.ts", { exact: true })).toBeVisible();
  await testInfo.attach("workspace-tree-search", {
    body: await inspector.screenshot(),
    contentType: "image/png"
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await testInfo.attach("workspace-tree-search-dark", {
    body: await inspector.screenshot(),
    contentType: "image/png"
  });
  const searchCommands = (await recordedCommandDetails(page)).filter((command) => command.type === "workspace.file.search");
  expect(searchCommands.at(-1)?.payload).toMatchObject({ query: "index", includeGenerated: true });
});

test("retries one failed directory without resetting the whole file tree", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [userMessage("message-1", "Retry one directory")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  const srcRow = inspector.getByRole("treeitem", { name: "文件夹 src", exact: true });
  await expect(srcRow).toBeVisible();
  await setMockAgentResponseFailure(page, "workspace.file.list", {
    code: "RESOURCE_CHANGED_EXTERNALLY",
    message: "目录读取失败。",
    recoverable: true
  });
  await srcRow.press("ArrowRight");
  const retry = inspector.getByRole("button", { name: "重试", exact: true });
  await expect(retry).toBeVisible();
  await page.evaluate(() => {
    delete (window as unknown as {
      __pi67TestAgent: { responseFailures: Record<string, unknown> };
    }).__pi67TestAgent.responseFailures["workspace.file.list"];
  });
  await retry.click();
  await expect(inspector.getByRole("treeitem", { name: "文件 main.ts 42 B", exact: true })).toBeVisible();
  await expect(srcRow).toHaveAttribute("aria-expanded", "true");
});

test("creates, renames, operates on, and trashes Workspace entries with an IME-safe dialog", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page, [userMessage("message-1", "Manage workspace files")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  const inspector = page.getByRole("complementary", { name: "任务检查器" });

  await inspector.getByRole("button", { name: "新建工作区项目" }).click();
  await page.getByRole("menuitem", { name: "新建文件", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "新建文件" });
  const fileName = createDialog.getByRole("textbox", { name: "文件名称" });
  await testInfo.attach("workspace-create-file-light", {
    body: await createDialog.screenshot(),
    contentType: "image/png"
  });
  await expect(fileName).toHaveAttribute("placeholder", "example.ts");
  await expect(createDialog.getByText("位置：工作区根目录", { exact: true })).toBeVisible();
  await fileName.fill("CON.txt");
  await expect(createDialog.getByText("该名称是 Windows 保留名称，请使用其他名称。")).toBeVisible();
  await expect(createDialog.getByRole("button", { name: "创建" })).toBeDisabled();
  expect((await recordedCommands(page)).filter((type) => type === "workspace.file.create")).toEqual([]);

  await fileName.fill("feature.md");
  await createDialog.getByRole("combobox", { name: "文件类型" }).selectOption("typescript");
  await expect(fileName).toHaveValue("feature.ts");
  await fileName.dispatchEvent("compositionstart");
  await fileName.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(createDialog).toBeVisible();
  expect((await recordedCommands(page)).filter((type) => type === "workspace.file.create")).toEqual([]);
  await fileName.dispatchEvent("compositionend");
  await fileName.press("Enter");
  await expect(createDialog).toHaveCount(0);
  await expect(page.getByRole("region", { name: "工作区文件与对话" })
    .getByRole("tab", { name: "feature.ts", exact: true })).toBeVisible();

  await inspector.getByRole("button", { name: "新建工作区项目" }).click();
  await page.getByRole("menuitem", { name: "新建文件夹", exact: true }).click();
  const directoryDialog = page.getByRole("dialog", { name: "新建文件夹" });
  await directoryDialog.getByRole("textbox", { name: "文件夹名称" }).fill("assets");
  await directoryDialog.getByRole("button", { name: "创建" }).click();
  const assetsRow = inspector.getByRole("treeitem", { name: "文件夹 assets", exact: true });
  await expect(assetsRow).toBeVisible();
  await inspector.getByRole("button", { name: "新建工作区项目" }).click();
  await page.getByRole("menuitem", { name: "新建文件", exact: true }).click();
  const nestedDialog = page.getByRole("dialog", { name: "新建文件" });
  await expect(nestedDialog.getByText("位置：assets", { exact: true })).toBeVisible();
  await nestedDialog.getByRole("textbox", { name: "文件名称" }).fill("config");
  await nestedDialog.getByRole("combobox", { name: "文件类型" }).selectOption("json");
  await nestedDialog.getByRole("button", { name: "创建" }).click();
  await expect(assetsRow).toHaveAttribute("aria-expanded", "true");
  await expect(inspector.getByRole("treeitem", { name: "文件 config.json 0 B", exact: true })).toHaveAttribute("aria-level", "2");

  let featureRow = inspector.getByRole("treeitem", { name: "文件 feature.ts 0 B", exact: true });
  await featureRow.getByRole("button", { name: "feature.ts 更多操作" }).click();
  await page.getByRole("menuitem", { name: "重命名" }).click();
  const renameDialog = page.getByRole("dialog", { name: "重命名“feature.ts”" });
  const renameInput = renameDialog.getByRole("textbox", { name: "文件名称" });
  await expect(renameInput).toHaveValue("feature.ts");
  expect(await renameInput.evaluate((input) => {
    const field = input as HTMLInputElement;
    return { start: field.selectionStart, end: field.selectionEnd };
  }))
    .toEqual({ start: 0, end: 7 });
  await renameInput.fill("renamed.ts");
  await renameDialog.getByRole("button", { name: "重命名" }).click();
  featureRow = inspector.getByRole("treeitem", { name: "文件 renamed.ts 0 B", exact: true });
  await expect(featureRow).toBeVisible();

  for (const action of ["使用系统默认应用打开", "复制相对路径", "复制绝对路径", "在系统文件管理器中显示"]) {
    await featureRow.getByRole("button", { name: "renamed.ts 更多操作" }).click();
    await page.getByRole("menuitem", { name: action, exact: true }).click();
  }
  const systemActions = await page.evaluate(() => (
    window as unknown as {
      __pi67WorkspaceEntryTest: {
        reveals: unknown[];
        defaultOpens: unknown[];
        copies: Array<{ kind: string }>;
      };
    }
  ).__pi67WorkspaceEntryTest);
  expect(systemActions.defaultOpens).toHaveLength(1);
  expect(systemActions.copies.map((entry) => entry.kind)).toEqual(["relative", "absolute"]);
  expect(systemActions.reveals).toHaveLength(1);
  await expect(page.getByText("已复制相对路径", { exact: true })).toBeVisible();
  await expect(page.getByText("已复制绝对路径", { exact: true })).toBeVisible();

  await featureRow.getByRole("button", { name: "renamed.ts 更多操作" }).click();
  await page.getByRole("menuitem", { name: "移到废纸篓" }).click();
  await expect(inspector.getByRole("treeitem", { name: /renamed\.ts/u })).toHaveCount(0);
});

test("owns cancel, discard, and save-and-close outcomes for dirty files", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [userMessage("message-1", "Close dirty files")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  const readmeRow = inspector.getByRole("treeitem", { name: "文件 README.md 24 B", exact: true });
  const fileSurface = page.getByRole("region", { name: "工作区文件与对话" });

  await readmeRow.click();
  await page.locator(".cm-content").fill("# Discard this draft\n");
  await fileSurface.getByRole("button", { name: "关闭 README.md" }).click();
  let closeDialog = page.getByRole("dialog", { name: "关闭 README.md" });
  expect(await closeDialog.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingTop)))
    .toBeGreaterThanOrEqual(20);
  await closeDialog.getByRole("button", { name: "取消" }).click();
  await expect(fileSurface.getByRole("tab", { name: /README\.md$/u })).toBeVisible();

  await fileSurface.getByRole("button", { name: "关闭 README.md" }).click();
  closeDialog = page.getByRole("dialog", { name: "关闭 README.md" });
  await closeDialog.getByRole("button", { name: "放弃修改" }).click();
  await expect(fileSurface.getByRole("tab", { name: /README\.md$/u })).toHaveCount(0);

  await readmeRow.click();
  await page.locator(".cm-content").fill("# Save this draft\n");
  await fileSurface.getByRole("button", { name: "关闭 README.md" }).click();
  closeDialog = page.getByRole("dialog", { name: "关闭 README.md" });
  await closeDialog.getByRole("button", { name: "保存并关闭" }).click();
  await expect(fileSurface.getByRole("tab", { name: /README\.md$/u })).toHaveCount(0);
  expect((await recordedCommands(page)).filter((type) => type === "workspace.file.save")).toHaveLength(1);
});

test("confirms before replacing a dirty draft with the disk version", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page, [userMessage("message-1", "Reload a dirty file")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await inspector.getByRole("treeitem", { name: "文件 README.md 24 B", exact: true }).click();
  const fileSurface = page.getByRole("region", { name: "工作区文件与对话" });
  const editor = page.locator(".cm-content");
  await editor.fill("# Keep this draft\n");
  await fileSurface.getByRole("button", { name: "重新读取", exact: true }).click();
  let reloadDialog = page.getByRole("dialog", { name: "重新读取 README.md" });
  await expect(reloadDialog).toContainText("无法在 Pi-67 中撤销");
  await testInfo.attach("workspace-dirty-reload", {
    body: await reloadDialog.screenshot(),
    contentType: "image/png"
  });
  await reloadDialog.getByRole("button", { name: "取消" }).click();
  await expect(editor).toContainText("Keep this draft");
  await expect(fileSurface.getByLabel("未保存")).toBeVisible();

  await fileSurface.getByRole("button", { name: "重新读取", exact: true }).click();
  reloadDialog = page.getByRole("dialog", { name: "重新读取 README.md" });
  await setMockAgentResponseFailure(page, "workspace.file.open", {
    code: "RESOURCE_CHANGED_EXTERNALLY",
    message: "磁盘文件暂时不可读。",
    recoverable: true
  });
  await reloadDialog.getByRole("button", { name: "放弃修改并重新读取" }).click();
  await expect(page.getByText("磁盘文件暂时不可读。", { exact: true })).toBeVisible();
  await expect(reloadDialog).toBeVisible();
  await expect(editor).toContainText("Keep this draft");
  await expect(fileSurface.getByLabel("未保存")).toBeVisible();
  await page.evaluate(() => {
    delete (window as unknown as {
      __pi67TestAgent: { responseFailures: Record<string, unknown> };
    }).__pi67TestAgent.responseFailures["workspace.file.open"];
  });
  await reloadDialog.getByRole("button", { name: "放弃修改并重新读取" }).click();
  await expect(reloadDialog).toHaveCount(0);
  await expect(editor).toContainText("Fixture workspace");
  await expect(fileSurface.getByLabel("未保存")).toHaveCount(0);
});

test("recovers an external save conflict by preserving the draft in Save As", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [userMessage("message-1", "Recover a conflict")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await inspector.getByRole("treeitem", { name: "文件 README.md 24 B", exact: true }).click();
  await page.locator(".cm-content").fill("# Preserved conflict draft\n");
  await setMockAgentResponseFailure(page, "workspace.file.save", {
    code: "RESOURCE_CHANGED_EXTERNALLY",
    message: "磁盘文件已经变化。",
    recoverable: true
  });
  const fileSurface = page.getByRole("region", { name: "工作区文件与对话" });
  await fileSurface.getByRole("button", { name: "保存", exact: true }).click();
  const conflict = fileSurface.getByRole("alert");
  await expect(conflict).toContainText("磁盘文件已经变化");
  await page.evaluate(() => {
    delete (window as unknown as {
      __pi67TestAgent: { responseFailures: Record<string, unknown> };
    }).__pi67TestAgent.responseFailures["workspace.file.save"];
  });
  await conflict.getByRole("button", { name: "将草稿另存为" }).click();
  const saveAsDialog = page.getByRole("dialog", { name: "将草稿另存为" });
  const saveAsName = saveAsDialog.getByRole("textbox", { name: "新文件名称" });
  await expect(saveAsName).toHaveValue("README-copy.md");
  await saveAsName.fill("README-recovered.md");
  await saveAsDialog.getByRole("button", { name: "另存草稿" }).click();
  await expect(fileSurface.getByRole("tab", { name: /README\.md$/u })).toHaveCount(0);
  await expect(fileSurface.getByRole("tab", { name: "README-recovered.md", exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("Preserved conflict draft");
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
  const firstMessageButton = firstMessage.getByRole("button");
  await expect(firstMessageButton).toBeVisible();
  await firstMessageButton.click();

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
