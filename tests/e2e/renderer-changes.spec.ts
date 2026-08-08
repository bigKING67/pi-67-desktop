import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  setMockAgentResponseFailure,
  setMockWorkspaceChanges
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("reviews bounded Session changes and inline Patch without claiming Git state", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "message-1",
    role: "user",
    createdAt: 1,
    parts: [{ type: "text", text: "Review the current changes" }]
  }]);
  await setMockWorkspaceChanges(page, {
    sessionId: "session-test",
    items: [{
      kind: "edit",
      toolCallId: "edit-current",
      path: "src/current.ts",
      pathTruncated: false,
      status: "completed",
      patch: "--- a/src/current.ts\n+++ b/src/current.ts\n@@ -1 +1 @@\n-old\n+new",
      patchTruncated: false,
      additions: 1,
      deletions: 1,
      firstChangedLine: 1
    }, {
      kind: "write",
      toolCallId: "write-generated",
      path: "src/generated.ts",
      pathTruncated: false,
      status: "completed",
      writtenBytes: 67,
      writtenLines: 3,
      metricsTruncated: false
    }],
    truncated: true,
    total: 4
  });
  await page.getByRole("button", { name: "选择工作区" }).click();

  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await inspector.getByRole("tab", { name: "修改", exact: true }).click();
  await expect(inspector.getByText("2 个文件 · 4 条记录", { exact: true })).toBeVisible();
  await expect(inspector.getByText("仅显示预算内最近记录；更早的修改仍保留在 Pi JSONL 中。", { exact: true })).toBeVisible();
  await expect(inspector.getByRole("list", { name: "当前会话修改记录" })).toBeVisible();
  await expect(inspector.getByRole("region", { name: "修改详情 src/generated.ts" })).toContainText(
    "write Tool Result 不包含写入前版本"
  );

  await inspector.getByText("src/current.ts", { exact: true }).click();
  const patch = inspector.getByLabel("本会话修改 Patch");
  await expect(patch).toContainText("-old");
  await expect(patch).toContainText("+new");
  await testInfo.attach("session-changes-light", {
    body: await inspector.screenshot(),
    contentType: "image/png"
  });

  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await testInfo.attach("session-changes-dark", {
    body: await inspector.screenshot(),
    contentType: "image/png"
  });

  await setMockAgentResponseFailure(page, "workspace.changes", {
    code: "RUNTIME_NOT_READY",
    message: "修改投影暂时不可用。",
    recoverable: true
  });
  await inspector.getByRole("button", { name: "刷新修改记录" }).click();
  await expect(inspector.getByRole("alert")).toContainText("修改投影暂时不可用。");
  await expect(patch).toContainText("+new");
});

test("groups historical Turns, isolates live changes, and reopens a revised change as unread", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "message-turn-1",
    role: "user",
    parts: [{ type: "text", text: "First turn" }]
  }, {
    id: "message-turn-2",
    role: "user",
    parts: [{ type: "text", text: "Second turn" }]
  }]);
  await setMockWorkspaceChanges(page, changesProjection("+first"));
  await page.getByRole("button", { name: "选择工作区" }).click();

  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await inspector.getByRole("tab", { name: "修改", exact: true }).click();
  await expect(inspector.getByRole("group", { name: "修改当前操作" })).toBeVisible();
  await expect(inspector.getByRole("group", { name: "修改第 2 轮" })).toBeVisible();
  await expect(inspector.getByRole("group", { name: "修改第 1 轮" })).toBeVisible();

  const first = inspector.getByRole("button", { name: "src/first.ts，未查看" });
  await first.click();
  await expect(inspector.getByRole("button", { name: "src/first.ts，已查看" })).toBeVisible();
  await inspector.getByRole("button", { name: "src/second.ts，未查看" }).click();
  await expect(inspector.getByRole("button", { name: "src/second.ts，已查看" })).toBeVisible();

  await setMockWorkspaceChanges(page, changesProjection("+revised"));
  await inspector.getByRole("button", { name: "刷新修改记录" }).click();
  await expect(inspector.getByRole("button", { name: "src/first.ts，未查看" })).toBeVisible();
  await expect(inspector.getByRole("region", { name: "修改详情 src/second.ts" })).toBeVisible();
});

function changesProjection(firstPatch: string) {
  return {
    sessionId: "session-test",
    items: [{
      kind: "edit",
      toolCallId: "edit-first",
      turnId: "message-turn-1",
      path: "src/first.ts",
      pathTruncated: false,
      status: "completed",
      patch: `@@\n${firstPatch}`,
      patchTruncated: false,
      additions: 1,
      deletions: 0,
      firstChangedLine: 1
    }, {
      kind: "edit",
      toolCallId: "edit-second",
      turnId: "message-turn-2",
      path: "src/second.ts",
      pathTruncated: false,
      status: "completed",
      patch: "@@\n+second",
      patchTruncated: false,
      additions: 1,
      deletions: 0,
      firstChangedLine: 1
    }, {
      kind: "write",
      toolCallId: "write-live",
      path: "src/live.ts",
      pathTruncated: false,
      status: "running",
      writtenBytes: 12,
      writtenLines: 1,
      metricsTruncated: false
    }],
    truncated: false,
    total: 3
  };
}
