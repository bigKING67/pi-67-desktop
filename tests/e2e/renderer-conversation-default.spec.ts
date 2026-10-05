import { expect, test } from "@playwright/test";
import { DEFAULT_CONTEXT_MEMORY_CONFIGURATION } from "../../packages/domain/src/index.js";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";
import { recordedCommandDetails } from "./pi67-renderer-fixture.js";
import { openWorkbench } from "./renderer-workbench-test-fixture.js";
const modifier = process.platform === "darwin" ? "Meta" : "Control";
const teamId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";

test("explicit default is inherited while temporary private work and existing text remain isolated", async ({ page }, testInfo) => {
  await openWorkbench(page, {}, { responseResults: {
    "context.config.get": { ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION, revision: "fixture" },
    "enterprise.identity.get": { state: "signed-in", userId: "fixture-user", accountId: teamId },
    "enterprise.team.list": { items: [{ id: teamId, name: "示例团队", role: "owner", entitlementStatus: "active", planCode: "test", maxMembers: 5, memberCount: 1, projectCount: 1 }], total: 1 },
    "enterprise.project.list": { items: [{ id: projectId, accountId: teamId, name: "示例项目", slug: "demo", status: "active", bindingCount: 1, candidateCount: 0, sharedAssetCount: 0, updatedAt: 1 }], total: 1 },
    "enterprise.workspace.get": { state: "bound", workspaceId: DEFAULT_MOCK_WORKSPACE.id, accountId: teamId, enterpriseProjectId: projectId }
  } });
  await page.keyboard.press(`${modifier}+n`);
  const surface = page.getByTestId("new-session-intent");
  await expect(surface.getByRole("button", { name: "对话归属：私人", exact: true })).toBeVisible();
  await expect(surface.getByText("默认设置只影响", { exact: false })).toHaveCount(0);
  await surface.getByRole("button", { name: "对话归属：私人", exact: true }).click();
  await surface.getByRole("radio", { name: "团队项目", exact: true }).check();
  const save = surface.getByRole("button", { name: "设为工作区默认", exact: true });
  await expect(save).toBeEnabled();
  await expect(surface).toContainText("已预选此工作区绑定的项目");
  await save.focus();
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(surface.getByRole("button", { name: "对话归属：示例团队 / 示例项目", exact: true })).toBeVisible();
  const composer = page.getByRole("textbox", { name: "给 Pi 发送消息" });
  await composer.fill("保留在团队草稿的内容");
  await surface.getByRole("button", { name: "对话归属：示例团队 / 示例项目", exact: true }).click();
  await surface.getByRole("radio", { name: "私人", exact: true }).check();
  await surface.getByRole("button", { name: "仅本次使用", exact: true }).click();
  await expect(composer).toHaveValue("");
  await expect(surface.getByRole("button", { name: "对话归属：私人", exact: true })).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { pi67: { system: import("../../packages/protocol/src/index.js").DesktopSystemBridge } }).pi67.system.loadWorkbenchState())).conversationDefaults?.[0]?.choice.kind).toBe("team");
  await composer.fill("仅本次私人内容");
  await page.keyboard.press(`${modifier}+n`);
  await expect(surface.getByRole("button", { name: "对话归属：示例团队 / 示例项目", exact: true })).toBeVisible();
  await expect(composer).toHaveValue("");
  expect((await recordedCommandDetails(page)).some(command => command.type === "session.create")).toBe(false);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("conversation-default.png") });
  await surface.getByRole("button", { name: "对话归属：示例团队 / 示例项目", exact: true }).click();
  await expect(surface.getByRole("button", { name: "设为工作区默认", exact: true })).toBeEnabled();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("conversation-default-expanded.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("conversation-default-dark-expanded.png") });
  await surface.getByRole("button", { name: "对话归属：示例团队 / 示例项目", exact: true }).click();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("conversation-default-dark.png") });
  await composer.fill("在已选项目下开始任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(async () => (await recordedCommandDetails(page)).filter(command => command.type === "session.create")).toHaveLength(1);
  expect((await recordedCommandDetails(page)).find(command => command.type === "session.create")?.payload).toMatchObject({ teamScope: { teamId, projectId } });
});
