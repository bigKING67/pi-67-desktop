import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  setMockWorkspaceChanges
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("lists the files a turn changed under its answer and opens them", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page, turnMessages());
  await setMockWorkspaceChanges(page, {
    sessionId: "session-test",
    items: [
      edit("edit-old-turn", "message-turn-1", "src/old.ts"),
      edit("edit-readme", "message-turn-2", "README.md"),
      write("write-generated", "message-turn-2", "src/generated.ts"),
      { ...edit("edit-failed", "message-turn-2", "src/failed.ts"), status: "failed" },
      edit("edit-outside", "message-turn-2", "/elsewhere/notes.md")
    ],
    truncated: false,
    total: 5
  });
  await page.getByRole("button", { name: "选择工作区" }).click();

  const answer = page.locator('[data-message-id="assistant-answer-2"]');
  const card = answer.getByRole("region", { name: "本轮修改的文件" });
  await expect(card).toContainText("本轮修改的文件 · 3");
  await expect(card.getByRole("listitem")).toHaveCount(3);
  await expect(card).toContainText("新建或覆盖");
  await expect(card).toContainText("1 项未完成");
  await expect(card).not.toContainText("old.ts");
  await expect(card.getByRole("button", { name: "打开 /elsewhere/notes.md" })).toHaveCount(0);
  await expect(page.locator('[data-message-id="assistant-answer-1"]')
    .getByRole("region", { name: "本轮修改的文件" })).toBeVisible();

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    for (const width of [1440, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await answer.scrollIntoViewIfNeeded();
      const name = `answer-changed-files-${colorScheme}-${width}`;
      const path = `artifacts/visual-review/${name}.png`;
      await answer.screenshot({ path, animations: "disabled" });
      await testInfo.attach(name, { path, contentType: "image/png" });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });

  await card.getByRole("button", { name: "打开 README.md" }).click();
  const fileSurface = page.getByRole("region", { name: "工作区文件与对话" });
  await expect(fileSurface.getByRole("tab", { name: "README.md", exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("# Fixture workspace");
});

test("focuses the turn in the Changes Inspector and collapses long lists", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, turnMessages());
  const paths = Array.from({ length: 7 }, (_, index) => `src/file-${index + 1}.ts`);
  await setMockWorkspaceChanges(page, {
    sessionId: "session-test",
    items: paths.map((path, index) => edit(`edit-${index + 1}`, "message-turn-2", path)),
    truncated: false,
    total: paths.length
  });
  await page.getByRole("button", { name: "选择工作区" }).click();

  const card = page.locator('[data-message-id="assistant-answer-2"]')
    .getByRole("region", { name: "本轮修改的文件" });
  await expect(card.getByRole("listitem")).toHaveCount(5);
  await expect(card.getByRole("listitem").first()).toContainText("file-7.ts");
  await card.getByRole("button", { name: "查看全部 7 个文件" }).click();

  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await expect(inspector.getByRole("tab", { name: "修改", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(inspector.getByRole("tab", { name: "会话修改" })).toHaveAttribute("aria-selected", "true");
  await expect(inspector.getByRole("region", { name: "修改详情 src/file-7.ts" })).toBeVisible();
});

function turnMessages() {
  return [
    userMessage("message-turn-1", "First turn"),
    toolCall("assistant-call-1", "edit-old-turn", "edit"),
    toolResult("edit-old-turn", "edit"),
    answerMessage("assistant-answer-1", "First turn done."),
    userMessage("message-turn-2", "Second turn"),
    toolCall("assistant-call-2", "edit-readme", "edit"),
    toolResult("edit-readme", "edit"),
    answerMessage("assistant-answer-2", "Second turn done.")
  ];
}

function userMessage(id: string, text: string) {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function answerMessage(id: string, text: string) {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

function toolCall(id: string, callId: string, name: string) {
  return { id, role: "assistant", parts: [{ type: "tool-call", id: callId, name, status: "completed" }] };
}

function toolResult(callId: string, name: string) {
  return { id: callId, role: "tool", toolName: name, parts: [{ type: "text", text: "ok" }] };
}

function edit(toolCallId: string, turnId: string, path: string) {
  return {
    kind: "edit",
    toolCallId,
    turnId,
    path,
    pathTruncated: false,
    status: "completed",
    patch: "@@\n-old\n+new",
    patchTruncated: false,
    additions: 1,
    deletions: 1,
    firstChangedLine: 1
  };
}

function write(toolCallId: string, turnId: string, path: string) {
  return {
    kind: "write",
    toolCallId,
    turnId,
    path,
    pathTruncated: false,
    status: "completed",
    writtenBytes: 67,
    writtenLines: 3,
    metricsTruncated: false
  };
}
