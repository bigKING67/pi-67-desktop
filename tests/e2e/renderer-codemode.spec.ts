import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge, type FixtureMessage } from "./pi67-renderer-fixture.js";

for (const theme of ["light", "dark"] as const) {
  test(`keeps nested failures inspectable after script success in ${theme}`, async ({ page }) => {
    await installMockDesktopBridge(page);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/");
    await attachMockAgent(page, nestedMessages());
    await page.getByRole("button", { name: "选择工作区" }).click();
    const group = page.getByTestId("transcript-process-group");
    await expect(group).toHaveAttribute("data-process-outcome", "completed-with-warnings");
    await expect(group.locator(":scope > summary")).toContainText("3 次工具调用 · 1 个步骤未成功");
    await group.getByRole("button", { name: "查看未成功步骤" }).focus();
    await page.keyboard.press("Enter");
    const child = group.locator('[data-parent-tool-call-id="script"]');
    await expect(child).toHaveCount(1);
    await expect(child).toContainText("子调用");
    await expect(child).toContainText("上级调用");
    await expect(child).toContainText("计划模式禁止写入");
    await expect(child).toContainText("独立工具输出未保留");
    await group.getByRole("button", { name: "显示全部步骤" }).click();
    await expect(group.locator('[data-parent-tool-call-id="script"]')).toHaveCount(2);
    await group.screenshot({ path: `artifacts/visual-review/codemode/${theme}.png`, animations: "disabled" });
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(group).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await group.screenshot({ path: `artifacts/visual-review/codemode/${theme}-narrow.png`, animations: "disabled" });
  });
}

test("reports an incomplete nested record separately from root success", async ({ page }) => {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page, nestedMessages(false));
  await page.getByRole("button", { name: "选择工作区" }).click();
  const group = page.getByTestId("transcript-process-group");
  await expect(group.locator(":scope > summary")).toContainText("2 个步骤未成功");
  await group.getByRole("button", { name: "查看未成功步骤" }).click();
  const root = group.locator('[data-nested-incomplete="true"]');
  await expect(root).toHaveAttribute("data-tool-status", "completed");
  await expect(root).toContainText("子调用记录不完整");
  await expect(group.locator('[data-parent-tool-call-id="script"]')).toHaveCount(1);
});

function nestedMessages(complete = true): FixtureMessage[] {
  return [
    { id: "user", role: "user", parts: [{ type: "text", text: "读取资料并检查执行结果" }] },
    { id: "assistant", role: "assistant", parts: [
      { type: "tool-call", id: "script", name: "codemode", status: "completed", execution: {
        toolCallId: "script", toolName: "codemode", toolKind: "generic", status: "completed",
        projectionSource: "durable", resultState: "present", nestedRecord: { complete }
      } },
      { type: "tool-call", id: "script/1", name: "read", status: "completed", execution: {
        toolCallId: "script/1", parentToolCallId: "script", toolName: "read", toolKind: "read", status: "completed",
        projectionSource: "durable", resultState: "present", durationMs: 8, timingSource: "pi-result",
        inputSummary: { text: '{"path":"notes.md"}', truncated: false }
      } },
      { type: "tool-call", id: "script/2", name: "write", status: "failed", execution: {
        toolCallId: "script/2", parentToolCallId: "script", toolName: "write", toolKind: "edit", status: "failed",
        projectionSource: "durable", resultState: "present", durationMs: 2, timingSource: "pi-result",
        failure: { detailState: "available", source: "pi-result", message: { text: "计划模式禁止写入，本次工具未执行。", truncated: false } }
      } }
    ] },
    { id: "script", role: "tool", toolName: "codemode", parts: [{ type: "text", text: "Script completed" }] },
    { id: "answer", role: "assistant", parts: [{ type: "text", text: "已读完资料。写入请求被计划模式拒绝。" }] }
  ];
}
