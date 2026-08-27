import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommandDetails
} from "./pi67-renderer-fixture.js";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";

test("reopens a Prompt-Stash-restored Session without resyncing its synthetic Task", async ({ page }) => {
  const conversation = {
    kind: "session" as const,
    workspaceId: DEFAULT_MOCK_WORKSPACE.id,
    sessionFileIdentity: "session-file-draft-recovery",
    sessionPath: "/sessions/draft-recovery.jsonl"
  };
  await installMockDesktopBridge(page, {
    initialWorkspaces: [DEFAULT_MOCK_WORKSPACE],
    currentWorkspaceId: DEFAULT_MOCK_WORKSPACE.id,
    selectedSurface: { kind: "conversation", conversation },
    initialComposerDraftState: {
      version: 1,
      drafts: [{
        conversation,
        text: "",
        streamBehavior: "followUp",
        updatedAt: 1,
        promptStash: [{
          id: "stash-after-restart",
          text: "重启后仍需保留的暂存 Prompt",
          createdAt: 1
        }]
      }],
      selectedConversation: conversation
    }
  });

  await page.goto("/");
  await attachMockAgent(page);
  await expect(page.getByRole("button", { name: "恢复任务" })).toBeVisible();
  await expect(page.getByText("对话草稿等待恢复", { exact: true })).toBeVisible();
  await clearRecordedCommands(page);

  await page.getByRole("button", { name: "恢复任务" }).click();

  await expect(page.getByLabel("给 Pi 发送消息")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prompt 暂存，1 条" })).toBeVisible();
  await expect(page.getByText("正在恢复任务", { exact: true })).toHaveCount(0);
  const commands = await recordedCommandDetails(page);
  expect(commands.some((command) => command.type === "projection.resync")).toBe(false);
  const initialize = commands.find((command) => command.type === "runtime.initialize");
  expect(initialize).toEqual(expect.objectContaining({
    payload: expect.objectContaining({ sessionPath: conversation.sessionPath }),
    context: expect.objectContaining({
      scope: "task",
      workspaceId: DEFAULT_MOCK_WORKSPACE.id,
      taskId: expect.any(String),
      taskGeneration: 1
    })
  }));
  expect(initialize?.context).not.toHaveProperty("sessionId");
});
