import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge, recordedCommandDetails } from "./pi67-renderer-fixture.js";
import { signIn } from "./pi67-team-chat-controls.js";
import type { MockTeamChatState } from "./pi67-team-chat-command-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("creates an Agent that runs on this Desktop in one step and stops it from Agent 设置", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], {}, { responseResults: {
    "enterprise.project.list": { items: [{ id: "project-hk", accountId: "team-1", name: "港股研究", slug: "project-hk", status: "active",
      bindingCount: 0, candidateCount: 0, sharedAssetCount: 0, updatedAt: 1 }], total: 1 }
  } });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("group", { name: "工作模式" }).getByRole("button", { name: "聊天" }).click();
  await signIn(page);
  const navigation = page.getByTestId("team-chat-navigation");
  await expect(navigation.getByRole("button", { name: "管理我的 Agent" })).toHaveCount(0);

  await page.getByTestId("team-chat-new-agent").click();
  const create = page.getByRole("dialog", { name: "新建 Agent" });
  await create.getByRole("textbox", { name: "名称" }).fill("写作助手");
  // The sole active project is prefilled; the model is an explicit choice.
  await expect(create.getByRole("button", { name: /港股研究.*团队项目/u })).toBeVisible();
  await expect(create.getByRole("button", { name: "新建并运行" })).toBeDisabled();
  await create.getByRole("button", { name: /模型$/u }).click();
  await page.getByRole("listbox", { name: "模型" }).locator('[role="option"]:not([aria-disabled="true"])').first().click();
  await create.getByRole("button", { name: "新建并运行" }).click();
  await expect(create).toHaveCount(0);
  await expect(page.getByTestId("title-context-current")).toHaveText("写作助手");
  const hosted = await page.evaluate(() => (window as unknown as { __pi67MockTeamChat: MockTeamChatState }).__pi67MockTeamChat.agentHost.bindings);
  expect(hosted).toEqual([expect.objectContaining({ projectId: "project-hk", enabled: true })]);
  // Teammates see the model's display name, not provider and model IDs.
  const bind = (await recordedCommandDetails(page)).find((command) => command.type === "teamChat.agent.host.bind");
  const modelLabel = (bind?.payload as { modelLabel?: unknown } | undefined)?.modelLabel;
  expect(typeof modelLabel).toBe("string");
  expect(modelLabel).not.toContain(" · ");

  await page.getByRole("button", { name: "Agent 设置" }).click();
  const settings = page.getByRole("dialog", { name: "Agent 设置" });
  const runHere = settings.getByRole("switch", { name: "在这台电脑上运行" });
  await expect(runHere).toBeChecked();
  await expect(settings.getByRole("button", { name: "保存" })).toHaveCount(0);
  await settings.locator("label").filter({ has: page.getByRole("switch", { name: "在这台电脑上运行" }) }).click();
  await expect(settings.getByText("未在这台电脑上运行。同事的请求会在 10 分钟后过期。")).toBeVisible();
  await settings.getByRole("button", { name: "保存" }).click();
  await expect(settings.getByRole("button", { name: "保存" })).toHaveCount(0);
  const stopped = await page.evaluate(() => (window as unknown as { __pi67MockTeamChat: MockTeamChatState }).__pi67MockTeamChat.agentHost.bindings);
  expect(stopped).toEqual([]);
});
