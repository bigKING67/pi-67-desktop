import { expect, test } from "@playwright/test";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";
import { DEFAULT_CONTEXT_MEMORY_CONFIGURATION } from "../../packages/domain/src/index.js";
import { attachMockAgent, currentMockSessionAuthority, installMockDesktopBridge, recordedCommandDetails, setMockAgentResponseDelay, setMockAgentResponseResult } from "./pi67-renderer-fixture.js";

const configuration = { ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION, revision: "fixture-1" };
const status = { provider: "openviking", health: "healthy", owner: "pi67-openviking", effectivePrivacyMode: "private-learning", endpoint: configuration.endpoint, configured: true, conflictExtensions: [], lastCheckedAt: 1 };

test("memory settings preserve one draft across tabs, use keyboard radios, and guard navigation", async ({ page }) => {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page, [], {}, { responseResults: {
    "context.status.get": status,
    "context.config.get": configuration,
    "enterprise.identity.get": { state: "signed-out" },
    "enterprise.workspace.get": { state: "unbound", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  } });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("button", { name: "帮助与设置" }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "上下文与记忆", exact: true }).click();
  const settings = page.getByTestId("context-memory-settings");
  await expect(settings.getByRole("tab", { name: "记忆与隐私" })).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByRole("radio")).toHaveCount(4);
  const privateMode = settings.getByRole("radio", { name: /^私人学习/ });
  await expect(privateMode).toBeChecked();
  await privateMode.focus();
  await page.keyboard.press("ArrowDown");
  await expect(settings.getByRole("radio", { name: /完整学习/ })).toBeChecked();
  await expect(settings.getByRole("button", { name: "测试连接" })).toBeDisabled();
  await settings.getByRole("tab", { name: "企业经验" }).click();
  await settings.getByRole("textbox", { name: "企业上下文网关地址" }).fill("https://memory.example.test");
  await settings.getByRole("tab", { name: "高级", exact: true }).click();
  await expect(settings.getByText("上下文参数", { exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "立即归档" })).toHaveCount(0);
  await settings.getByRole("tab", { name: "记忆与隐私" }).click();
  await expect(settings.getByRole("radio", { name: /完整学习/ })).toBeChecked();
  await page.getByRole("button", { name: "外观", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  const saved = { ...configuration, revision: "fixture-2", defaultPrivacyMode: "full-learning", enterpriseGatewayEndpoint: "https://memory.example.test" };
  await setMockAgentResponseResult(page, "context.config.update", saved);
  await settings.getByRole("button", { name: "保存更改" }).click();
  await expect(settings.getByRole("button", { name: "保存更改" })).toBeDisabled();
  const writes = (await recordedCommandDetails(page)).filter((command) => command.type === "context.config.update");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.payload).toMatchObject({ defaultPrivacyMode: "full-learning", enterpriseGatewayEndpoint: "https://memory.example.test", expectedRevision: "fixture-1" });
  await expect(settings.getByRole("button", { name: "测试连接" })).toBeEnabled();
  await settings.getByRole("tab", { name: "企业经验" }).click();
  await expect(settings.getByRole("textbox", { name: "企业上下文网关地址" })).toHaveValue("https://memory.example.test");
  await page.getByRole("button", { name: "返回工作台" }).click();
  await setMockAgentResponseResult(page, "context.session.commit", { kind: "accepted", operationId: "archive-test", cancellable: false });
  await setMockAgentResponseDelay(page, "context.session.commit", 300);
  await page.getByRole("tab", { name: "上下文", exact: true }).click();
  await page.getByRole("tab", { name: "记忆", exact: true }).click();
  const authority = await currentMockSessionAuthority(page);
  await page.getByRole("button", { name: "立即归档", exact: true }).click();
  await expect(page.getByRole("button", { name: "正在提交…", exact: true })).toBeDisabled();
  await expect(page.getByText("会话归档已受理", { exact: true })).toBeVisible();
  const archives = (await recordedCommandDetails(page)).filter((command) => command.type === "context.session.commit");
  expect(archives).toHaveLength(1);
  expect(archives[0]?.payload).toMatchObject({ sessionId: authority.sessionId, submissionId: expect.any(String) });
  expect(archives[0]?.context).toMatchObject({ scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id });

});
