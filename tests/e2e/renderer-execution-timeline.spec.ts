import { expect, test } from "@playwright/test";
import { attachMockAgent, emitMockAgentEvent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";

test("groups explorations, quiets success, and leads with the running step", async ({ page }) => {
  await installMockDesktopBridge(page, { inspectorDocked: "unset" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  const operationId = "operation-baseline";
  const call = (id: string, name: string, summary: string) => ({ type: "tool-call" as const, id, name, status: "completed" as const, summary });
  await page.goto("/");
  await attachMockAgent(page, [
    { id: "u1", role: "user", parts: [{ type: "text", text: "检查登录页的表单校验，并修复手机号格式错误的问题" }] },
    { id: "a1", role: "assistant", parts: [
      { type: "thinking", text: "先找到登录表单组件和校验函数，再确认手机号正则。" },
      { type: "text", text: "先定位登录表单的校验逻辑。" },
      call("t1", "grep", "{\"pattern\":\"validatePhone\",\"path\":\"src\"}"),
      call("t2", "read", "{\"path\":\"src/auth/LoginForm.tsx\"}"),
      call("t3", "read", "{\"path\":\"src/auth/validators.ts\"}")
    ] },
    { id: "t1", role: "tool", toolName: "grep", parts: [{ type: "text", text: "src/auth/validators.ts:12: export function validatePhone" }] },
    { id: "t2", role: "tool", toolName: "read", parts: [{ type: "text", text: "export function LoginForm() {}" }] },
    { id: "t3", role: "tool", toolName: "read", parts: [{ type: "text", text: "const PHONE = /^1\\d{9}$/;" }] },
    { id: "a2", role: "assistant", parts: [
      { type: "text", text: "正则少了一位，修复并运行测试。" },
      call("t4", "edit", "{\"path\":\"src/auth/validators.ts\"}"),
      call("t5", "bash", "{\"command\":\"pnpm test src/auth\"}")
    ] },
    { id: "t4", role: "tool", toolName: "edit", parts: [{ type: "text", text: "Applied 1 edit" }] },
    { id: "t5", role: "tool", toolName: "bash", parts: [{ type: "text", text: "✓ 12 tests passed" }] },
    { id: "a3", role: "assistant", parts: [{ type: "text", text: "已修复：手机号正则从 9 位改为 10 位（`/^1\\d{10}$/`），`src/auth` 下 12 个测试全部通过。" }] }
  ]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  const process = page.getByTestId("transcript-process-group").first();
  await expect(process.locator(":scope > summary")).toContainText("执行已结束 · 5 次工具调用");
  await page.screenshot({ path: "artifacts/visual-review/execution-timeline/settled-dark.png", animations: "disabled" });

  await process.locator(":scope > summary").click();
  // Three consecutive successful reads/searches collapse into one expandable step.
  const exploration = process.locator('[data-process-step="exploration"]');
  await expect(exploration).toHaveCount(1);
  await expect(exploration).toContainText("搜索 1 次，浏览了 2 个文件");
  await expect(process.locator('[data-process-step="tool"]')).toHaveCount(2);
  // Narration reads as plain text; success is an icon with screen-reader text only.
  await expect(process.getByText("正则少了一位，修复并运行测试。", { exact: true })).toBeVisible();
  const editCard = process.locator('[data-process-step="tool"] [data-tool-status="completed"]').first();
  await expect(editCard.locator(":scope > summary .sr-only")).toHaveText("已完成");
  await expect(editCard.locator(":scope > summary").getByText("已完成", { exact: true })).toHaveClass("sr-only");
  await page.screenshot({ path: "artifacts/visual-review/execution-timeline/settled-expanded-dark.png", animations: "disabled" });
  await exploration.locator("summary").first().click();
  await expect(exploration.locator('[data-tool-status="completed"]')).toHaveCount(3);
  await exploration.locator("summary").first().click();

  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: { operation: { operationId, kind: "prompt", lifecycle: "running", cancellable: true, sessionId: "session-test",
      sessionFileIdentity: "session-file-fixture-demo", sessionGeneration: 1, startedAt: Date.now() } }
  }, { operationId });
  for (const activity of [
    { toolCallId: "r1", toolName: "grep", toolKind: "search", authorization: { mode: "auto", reason: "read-only" } },
    { toolCallId: "r2", toolName: "read", toolKind: "read", authorization: { mode: "auto", reason: "read-only" } },
    { toolCallId: "r3", toolName: "bash", toolKind: "shell", authorization: { mode: "auto", reason: "workspace-write" } }
  ] as const) {
    await emitMockAgentEvent(page, { type: "operation.activityChanged", payload: { operationId, activity: { kind: "tool", status: "running", ...activity } } }, { operationId });
  }
  // While running nothing regroups: calls stay individual, keep their AUTO reason, and the header carries a live clock.
  await expect(process.locator('[data-process-step="exploration"]')).toHaveCount(0);
  await expect(process.locator('[data-tool-status="running"]')).toHaveCount(3);
  await expect(process.getByText("AUTO · Workspace 内写入", { exact: true })).toBeVisible();
  await expect(process.locator(":scope > summary")).toContainText(/· \d+:\d{2}/u);
  await page.screenshot({ path: "artifacts/visual-review/execution-timeline/running-dark.png", animations: "disabled" });
});
