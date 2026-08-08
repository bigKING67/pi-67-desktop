import { expect, test } from "@playwright/test";
import type { RepositoryEnvironmentSnapshot } from "@pi67/protocol";
import {
  attachMockAgent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";

const READY_REPOSITORY: RepositoryEnvironmentSnapshot = {
  workspaceId: "workspace-pi-demo",
  status: "ready",
  revision: 1,
  observedAt: 10,
  stale: false,
  repository: {
    repositoryGroupId: `repo_${"a".repeat(32)}`,
    assurance: "filesystem",
    currentWorktreeId: "worktree-current"
  },
  worktrees: [{
    worktreeId: "worktree-current",
    workspaceId: "workspace-pi-demo",
    kind: "primary",
    status: "ready",
    branchName: "main",
    headSha: "b".repeat(40),
    detached: false,
    locked: false
  }]
};

test("selects Local or Worktree without mutating Git and checkpoints the draft intent", async ({ page }, testInfo) => {
  await installMockDesktopBridge(page, { repositoryEnvironmentSnapshot: READY_REPOSITORY });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("button", { name: "在 pi-demo 新建会话" }).click();

  const selector = page.getByTestId("new-session-environment-selector");
  const local = selector.getByRole("radio", { name: /当前工作区/u });
  const worktree = selector.getByRole("radio", { name: /隔离 Worktree/u });
  const localOption = selector.locator("label").filter({ hasText: "当前工作区" });
  const worktreeOption = selector.locator("label").filter({ hasText: "隔离 Worktree" });
  await expect(selector).toBeVisible();
  await expect(local).toBeChecked();
  await expect(worktree).toBeEnabled();
  await expect(selector).toContainText("选择环境不会修改 Git；只有首次发送才开始创建。");

  await page.getByRole("textbox", { name: "给 Pi 发送消息" }).fill("在隔离 Worktree 中继续");
  await local.focus();
  await page.keyboard.press("ArrowRight");
  await expect(worktree).toBeChecked();
  await expect(local).not.toBeChecked();
  await expect(worktreeOption).not.toHaveCSS("box-shadow", "none");
  await expect.poll(() => readPersistedEnvironmentIntent(page)).toBe("worktree");
  await expect.poll(() => readWorktreeCalls(page)).toEqual({
    createCalls: 0,
    advanceCalls: 0,
    rollbackCalls: 0
  });
  await page.screenshot({ path: testInfo.outputPath("worktree-environment-light.png"), animations: "disabled" });

  await localOption.click();
  await expect(local).toBeChecked();
  await expect(worktree).not.toBeChecked();
  await expect.poll(() => readPersistedEnvironmentIntent(page)).toBeUndefined();
  await expect.poll(() => readWorktreeCalls(page)).toEqual({
    createCalls: 0,
    advanceCalls: 0,
    rollbackCalls: 0
  });
});

test("keeps the environment selector single-column and legible in narrow dark mode", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 680, height: 820 });
  await installMockDesktopBridge(page, { repositoryEnvironmentSnapshot: READY_REPOSITORY });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("button", { name: "显示会话导航" }).click();
  await page.getByRole("button", { name: "在 pi-demo 新建会话" }).click();
  await page.getByRole("button", { name: "关闭会话导航" }).click();

  const selector = page.getByTestId("new-session-environment-selector");
  const localOption = selector.locator("label").filter({ hasText: "当前工作区" });
  const worktreeOption = selector.locator("label").filter({ hasText: "隔离 Worktree" });
  const localBox = await localOption.boundingBox();
  const worktreeBox = await worktreeOption.boundingBox();
  expect(localBox).not.toBeNull();
  expect(worktreeBox).not.toBeNull();
  expect(Math.abs(localBox!.x - worktreeBox!.x)).toBeLessThanOrEqual(1);
  expect(worktreeBox!.y).toBeGreaterThan(localBox!.y + localBox!.height);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await worktreeOption.click();
  await expect(worktreeOption).toHaveCSS("background-color", "rgb(32, 59, 50)");
  await expect(selector).toContainText("选择环境不会修改 Git；只有首次发送才开始创建。");
  await page.screenshot({ path: testInfo.outputPath("worktree-environment-dark-narrow.png"), animations: "disabled" });
});

test("keeps Worktree unavailable when the selected workspace is not a Git Repository", async ({ page }, testInfo) => {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("button", { name: "在 pi-demo 新建会话" }).click();

  const selector = page.getByTestId("new-session-environment-selector");
  const local = selector.getByRole("radio", { name: /当前工作区/u });
  const worktree = selector.getByRole("radio", { name: /隔离 Worktree/u });
  await expect(local).toBeChecked();
  await expect(worktree).toBeDisabled();
  await expect(selector).toContainText("当前工作区不是 Git Repository。");
  await expect(selector.getByRole("button", { name: "重新检查" })).toBeVisible();
  await expect.poll(() => readWorktreeCalls(page)).toEqual({
    createCalls: 0,
    advanceCalls: 0,
    rollbackCalls: 0
  });
  await page.screenshot({ path: testInfo.outputPath("worktree-environment-non-git.png"), animations: "disabled" });
});

async function readPersistedEnvironmentIntent(page: Parameters<typeof installMockDesktopBridge>[0]) {
  return page.evaluate(() => (
    window as unknown as {
      __pi67ComposerDraftTest: {
        state(): { drafts: Array<{ environmentIntent?: "local" | "worktree" }> };
      };
    }
  ).__pi67ComposerDraftTest.state().drafts[0]?.environmentIntent);
}

async function readWorktreeCalls(page: Parameters<typeof installMockDesktopBridge>[0]) {
  return page.evaluate(() => structuredClone((
    window as unknown as {
      __pi67WorktreeTest: {
        createCalls: number;
        advanceCalls: number;
        rollbackCalls: number;
      };
    }
  ).__pi67WorktreeTest));
}
