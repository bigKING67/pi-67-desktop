import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_CONTEXT_MEMORY_CONFIGURATION } from "../../packages/domain/src/index.js";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";
import { attachMockAgent, installMockDesktopBridge, recordedCommandDetails, setMockAgentResponseDelay, setMockAgentResponseFailure } from "./pi67-renderer-fixture.js";

const teamId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const command = "enterprise.knowledge.sync";

async function openSharedSettings(page: Page, bound = true) {
  const configuration = { ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION, revision: "fixture-1" };
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page, [], {}, { responseResults: {
    "context.status.get": { provider: "openviking", health: "healthy", owner: "pi67-openviking", effectivePrivacyMode: "private-learning", endpoint: configuration.endpoint, configured: true, conflictExtensions: [], lastCheckedAt: 1 },
    "context.config.get": configuration,
    "context.runtime.doctor": { checkedAt: 1, effectiveConfiguration: configuration, checks: [], status: {
      provider: "openviking", health: "degraded", owner: "pi67-openviking", effectivePrivacyMode: "private-learning",
      endpoint: configuration.endpoint, configured: true, conflictExtensions: [], lastCheckedAt: 1
    } },
    "enterprise.identity.get": { state: "signed-in", accountId: teamId, userId: "synthetic-user" },
    "enterprise.team.list": { items: [{ id: teamId, name: "Synthetic team", role: "owner", entitlementStatus: "active", planCode: "test", maxMembers: 5, memberCount: 1, projectCount: 1 }], total: 1 },
    "enterprise.project.list": { items: [], total: 0 },
    "enterprise.workspace.get": { state: bound ? "bound" : "unbound", workspaceId: DEFAULT_MOCK_WORKSPACE.id, ...(bound ? { accountId: teamId, enterpriseProjectId: projectId } : {}) },
    [command]: { progress: { epoch: "00000000-0000-4000-8000-000000000003", cursor: "1" }, pages: 1, headCursor: "1" },
    "enterprise.knowledge.index": { state: "published-local", snapshot: { epoch: teamId, cursor: "1" } }
  } });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("button", { name: "帮助与设置" }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "上下文与记忆", exact: true }).click();
  const settings = page.getByTestId("context-memory-settings");
  await settings.getByRole("tab", { name: "团队经验", exact: true }).click();
  await expect(settings.getByRole("button", { name: "同步团队内容", exact: true })).toBeEnabled();
  return settings;
}

test("explicit sync sends exact team/project scope and reports receipt, not index readiness", async ({ page }) => {
  const settings = await openSharedSettings(page);
  await settings.getByRole("button", { name: "同步团队内容", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("已接收当前团队内容（1 页）。这不代表检索索引已就绪。");
  await settings.getByRole("button", { name: "同步当前项目", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("已接收当前项目内容");
  const requests = (await recordedCommandDetails(page)).filter((entry) => entry.type === command);
  expect(requests.map((entry) => entry.payload)).toEqual([{ teamId }, { teamId, projectId }]);
  expect(requests.every((entry) => entry.context?.scope === "app")).toBe(true);
});

test("explicit index builds exact scopes, blocks concurrent sync and never claims search activation", async ({ page }) => {
  const settings = await openSharedSettings(page), type = "enterprise.knowledge.index";
  expect((await recordedCommandDetails(page)).filter(entry => entry.type === type)).toHaveLength(0);
  await expect(settings).toContainText("可能产生模型费用");
  await setMockAgentResponseDelay(page, type, 500);
  await settings.getByRole("button", { name: "构建团队索引", exact: true }).focus();
  await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
  await expect(settings.getByRole("button", { name: "构建团队索引", exact: true })).toBeFocused();
  expect(await settings.getByRole("button", { name: "构建团队索引", exact: true }).evaluate(button => button.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
  await expect(settings.getByRole("button", { name: "同步团队内容", exact: true })).toBeDisabled();
  await expect(settings.getByRole("button", { name: "构建当前项目索引", exact: true })).toBeDisabled();
  await expect(settings.getByRole("status")).toContainText("正在同步并构建本地索引");
  await expect(settings.getByRole("status")).toContainText("本次团队索引已构建。检索功能尚未默认启用");
  await setMockAgentResponseDelay(page, type, 0);
  await settings.getByRole("button", { name: "构建当前项目索引", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("本次项目索引已构建");
  const requests = (await recordedCommandDetails(page)).filter(entry => entry.type === type);
  expect(requests.map(entry => entry.payload)).toEqual([{ teamId }, { teamId, projectId }]);
  expect(requests.every(entry => entry.context?.scope === "app")).toBe(true);
});

test("index cancellation and leaving the scope cannot turn a late reply into success", async ({ page }) => {
  const settings = await openSharedSettings(page, false), type = "enterprise.knowledge.index";
  await expect(settings.getByRole("button", { name: "构建当前项目索引", exact: true })).toBeDisabled();
  await setMockAgentResponseDelay(page, type, 1000);
  const build = settings.getByRole("button", { name: "构建团队索引", exact: true });
  await build.click(); await settings.getByRole("button", { name: "停止构建", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("结果尚未确认");
  await expect(build).toBeEnabled();
  await build.click(); await expect(build).toBeDisabled();
  await settings.getByRole("tab", { name: "高级", exact: true }).click();
  await settings.getByRole("tab", { name: "团队经验", exact: true }).click();
  await expect(settings.getByRole("status")).toHaveCount(0);
  await setMockAgentResponseDelay(page, type, 1500); await build.click();
  await expect(settings.getByRole("status")).toContainText("本次团队索引已构建");
  expect((await recordedCommandDetails(page)).filter(entry => entry.type === type)).toHaveLength(3);
});

test("index failure exposes uncertain outcome and is never automatically retried", async ({ page }) => {
  const settings = await openSharedSettings(page), type = "enterprise.knowledge.index";
  await setMockAgentResponseFailure(page, type, { code: "RUNTIME_NOT_READY", message: "索引构建结果尚未确认，请勿立即重复构建。", recoverable: false });
  await settings.getByRole("button", { name: "构建团队索引", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("构建未确认完成");
  await expect(settings.getByRole("status")).toContainText("不会自动重试");
  expect((await recordedCommandDetails(page)).filter(entry => entry.type === type)).toHaveLength(1);
});

test("model authorization errors explain the next step without retrying", async ({ page }) => {
  const settings = await openSharedSettings(page), type = "enterprise.knowledge.index";
  await setMockAgentResponseFailure(page, type, { code: "RUNTIME_NOT_READY",
    message: "The current model is not authorized to process this team's shared content.", recoverable: false });
  await settings.getByRole("button", { name: "构建团队索引", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("请在网页端检查团队模型政策");
  await expect(settings.getByRole("status")).toContainText("不会自动重试");
  expect((await recordedCommandDetails(page)).filter(entry => entry.type === type)).toHaveLength(1);
});

test("pending sync prevents duplicate requests, cancels, and permits retry", async ({ page }) => {
  const settings = await openSharedSettings(page, false);
  const team = settings.getByRole("button", { name: "同步团队内容", exact: true });
  await expect(settings.getByRole("button", { name: "同步当前项目", exact: true })).toBeDisabled();
  await setMockAgentResponseDelay(page, command, 1500);
  await team.click();
  await expect(team).toBeDisabled();
  await expect(settings.getByRole("status")).toContainText("正在接收共享内容");
  await settings.getByRole("button", { name: "取消同步", exact: true }).click();
  await expect(settings.getByRole("status")).toContainText("已取消同步");
  await expect(team).toBeEnabled();
  expect((await recordedCommandDetails(page)).filter((entry) => entry.type === command)).toHaveLength(1);
  await setMockAgentResponseDelay(page, command, 0);
  await team.click();
  await expect(settings.getByRole("status")).toContainText("已接收当前团队内容");
});

test("failed sync is retryable and leaving the tab cannot publish a late result", async ({ page }) => {
  const settings = await openSharedSettings(page);
  const team = settings.getByRole("button", { name: "同步团队内容", exact: true });
  await setMockAgentResponseFailure(page, command, { code: "INTERNAL", message: "synthetic sync failure", recoverable: true });
  await team.click();
  await expect(settings.getByRole("status")).toContainText("同步未完成：synthetic sync failure");
  await expect(team).toBeEnabled();
  await page.evaluate((type) => {
    const fixture = window as unknown as { __pi67TestAgent: { responseFailures: Record<string, unknown> } };
    delete fixture.__pi67TestAgent.responseFailures[type];
  }, command);
  await setMockAgentResponseDelay(page, command, 300);
  await team.click();
  await expect(team).toBeDisabled();
  await settings.getByRole("tab", { name: "高级", exact: true }).click();
  await settings.getByRole("tab", { name: "团队经验", exact: true }).click();
  await expect(team).toBeEnabled();
  await expect(settings.getByRole("status")).toHaveCount(0);
  // Finish another request after the abandoned reply would have arrived.
  await setMockAgentResponseDelay(page, command, 600);
  await team.click();
  await expect(settings.getByRole("status")).toContainText("已接收当前团队内容");
});
