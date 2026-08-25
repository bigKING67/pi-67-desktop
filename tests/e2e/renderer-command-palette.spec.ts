import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  currentMockSessionAuthority,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommandDetails,
  recordedCommands,
  setMockAgentResponseFailure,
  waitForMockWorkspaceReady
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("opens the command palette by shortcut, restores focus, and invokes one command", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);
  await expect.poll(async () => (await recordedCommands(page)).includes(
    "session.catalog.query"
  )).toBe(true);

  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.focus();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "命令面板" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "命令面板" })).toHaveCount(0);
  await expect(composer).toBeFocused();

  await page.keyboard.press("Control+k");
  await expect.poll(async () => (await recordedCommands(page)).includes("command.list")).toBe(true);
  await expect(page.getByRole("option", { name: "/inspect Inspect runtime · 检查" })).toBeVisible();
  await clearRecordedCommands(page);
  await page.getByRole("option", { name: /压缩当前会话/u }).click();

  await expect(page.getByRole("dialog", { name: "命令面板" })).toHaveCount(0);
  await expect.poll(() => recordedCommands(page)).toEqual(["session.compact"]);
  expect((await recordedCommandDetails(page))[0]?.payload).toMatchObject({
    submissionId: expect.stringMatching(/^compaction-/u)
  });
});

test("invokes an Extension command with a caller-stable submission identity", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+k");

  await expect.poll(async () => (await recordedCommands(page)).includes("command.list")).toBe(true);
  const inspect = page.getByRole("option", { name: "/inspect Inspect runtime · 检查" });
  await expect(inspect).toBeVisible();
  await clearRecordedCommands(page);
  await inspect.click();

  await expect.poll(async () => (await recordedCommands(page)).includes("command.invoke")).toBe(true);
  const invocation = (await recordedCommandDetails(page)).find((command) => command.type === "command.invoke");
  expect(invocation?.payload).toMatchObject({
    submissionId: expect.stringMatching(/^command-/u),
    command: "inspect"
  });
});

test("navigates bounded results while the accessible combobox keeps focus", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+k");

  const search = page.getByLabel("搜索对话标题、正文、扩展命令和应用操作");
  await expect(search).toBeFocused();
  await search.press("ArrowDown");
  await expect(search).toBeFocused();
  const firstActiveId = await search.getAttribute("aria-activedescendant");
  expect(firstActiveId).toBeTruthy();
  const firstOption = page.locator(`[id="${firstActiveId}"]`);
  await expect(firstOption).toHaveAttribute("aria-selected", "true");
  await page.screenshot({
    path: "artifacts/visual-review/command-palette.png",
    animations: "disabled"
  });

  await page.keyboard.press("ArrowDown");
  await expect(search).toBeFocused();
  const secondActiveId = await search.getAttribute("aria-activedescendant");
  expect(secondActiveId).toBeTruthy();
  expect(secondActiveId).not.toBe(firstActiveId);

  await page.keyboard.press("End");
  const endActiveId = await search.getAttribute("aria-activedescendant");
  await expect(page.locator(`[id="${endActiveId}"]`)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  const homeActiveId = await search.getAttribute("aria-activedescendant");
  await expect(page.locator(`[id="${homeActiveId}"]`)).toHaveAttribute("aria-selected", "true");
  await expect(search).toBeFocused();
});

test("keeps visible keyboard focus on the Composer and command palette search", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const composer = page.getByLabel("给 Pi 发送消息");
  const composerShell = page.getByTestId("composer-shell");
  const unfocusedComposer = await composerShell.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderColor: style.borderColor, boxShadow: style.boxShadow };
  });
  await composer.focus();
  const focusedComposer = await composerShell.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderColor: style.borderColor, boxShadow: style.boxShadow };
  });
  expect(focusedComposer.borderColor).not.toBe(unfocusedComposer.borderColor);
  expect(focusedComposer.boxShadow).not.toBe("none");

  await page.keyboard.press("Control+k");
  const search = page.getByLabel("搜索对话标题、正文、扩展命令和应用操作");
  await expect(search).toBeFocused();
  const searchFocus = await search.locator("..").evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(searchFocus).toEqual({ outlineStyle: "solid", outlineWidth: "2px" });
});

test("does not execute a selected action while Windows IME confirmation is active", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+k");
  const search = page.getByLabel("搜索对话标题、正文、扩展命令和应用操作");
  await search.fill("inspect");
  await expect(page.getByRole("option", { name: /\/inspect/u })).toBeVisible();
  await expect(search).toHaveValue("inspect");
  await clearRecordedCommands(page);

  await search.evaluate((element) => {
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true
    });
    Object.defineProperty(event, "keyCode", { value: 229 });
    element.dispatchEvent(event);
  });

  await expect(page.getByRole("dialog", { name: "命令面板" })).toBeVisible();
  expect((await recordedCommands(page)).filter((command) => command === "command.invoke")).toEqual([]);
  await expect(search).toHaveValue("inspect");
  const activeId = await search.getAttribute("aria-activedescendant");
  expect(activeId).toBeTruthy();
  await expect(page.locator(`[id="${activeId}"]`)).toContainText("/inspect");

  await search.press("Enter");
  await expect.poll(async () => (await recordedCommands(page)).filter((command) => command === "command.invoke")).toHaveLength(1);
});

test("keeps Session search failures observable instead of presenting an authoritative empty result", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await setMockAgentResponseFailure(page, "session.catalog.query", {
    code: "INTERNAL",
    message: "fixture catalog failure",
    recoverable: true
  });
  await page.keyboard.press("Control+k");

  await page.getByLabel("搜索对话标题、正文、扩展命令和应用操作").fill("definitely-missing-session");
  await expect(page.getByRole("status").filter({ hasText: "对话目录查询失败" })).toBeVisible();
  await expect(page.getByText("对话目录暂时不可用", { exact: true })).toBeVisible();
});

test("matches Host scheduler availability while an operation is active", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    sessionCatalogItems: [
      {
        id: "session-test",
        fileIdentity: "session-file-fixture-demo",
        path: "/Users/test/.pi/agent/sessions/demo.jsonl",
        cwd: "/Users/test/Projects/pi-demo",
        name: "Current Session",
        modifiedAt: Date.now(),
        messageCount: 2
      },
      {
        id: "session-other",
        fileIdentity: "session-file-fixture-other",
        path: "/Users/test/.pi/agent/sessions/other.jsonl",
        cwd: "/Users/test/Projects/pi-demo",
        name: "Other Session",
        modifiedAt: Date.now() - 1_000,
        messageCount: 1
      }
    ]
  });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);
  await expect.poll(async () => (await recordedCommandDetails(page)).some((command) => (
    command.type === "runtime.initialize" && command.context?.scope === "task"
  ))).toBe(true);
  const sessionAuthority = await currentMockSessionAuthority(page);
  const operationId = "operation-palette-busy";
  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId,
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        ...sessionAuthority,
        startedAt: Date.now()
      }
    }
  }, { operationId, ...sessionAuthority });
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
  await page.keyboard.press("Control+k");

  await expect(page.getByRole("option", { name: /Other Session 当前任务结束后可用/u })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("option", { name: /\/inspect 当前任务结束后可用/u })).toHaveAttribute("aria-disabled", "true");
  const compact = page.getByRole("option", { name: /\/compact.*当前任务结束或停止后可用/u });
  await expect(compact).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("option", { name: /恢复与诊断/u })).not.toHaveAttribute("aria-disabled", "true");

  await clearRecordedCommands(page);
  await compact.dispatchEvent("click");
  await expect(page.getByRole("dialog", { name: "命令面板" })).toBeVisible();
  expect(await recordedCommands(page)).toEqual([]);
});
