import { expect, test } from "@playwright/test";
import type { DesktopSystemBridge } from "@pi67/protocol";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";
import { DEFAULT_CONTEXT_MEMORY_CONFIGURATION } from "../../packages/domain/src/index.js";
import { attachMockAgent, currentMockSessionAuthority, emitMockAgentEvent, installMockDesktopBridge, recordedCommandDetails, setMockAgentResponseDelay, setMockAgentResponseResult } from "./pi67-renderer-fixture.js";

const configuration = { ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION, revision: "fixture-1" };
const status = { provider: "openviking", health: "healthy", owner: "pi67-openviking", effectivePrivacyMode: "private-learning", endpoint: configuration.endpoint, configured: true, conflictExtensions: [], lastCheckedAt: 1 };

test("managed memory checks stay separate from legacy health in both themes", async ({ page }) => {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await page.evaluate(() => {
    const activation = { available: true, preference: "enabled", selectedAtLaunch: true,
      restartRequired: false, busy: false, lifecycle: "running", issue: "none" } as const;
    let checks = 0;
    (window as unknown as { pi67: { system: DesktopSystemBridge } }).pi67.system.localMemoryActivation = {
      get: async () => activation,
      setEnabled: async () => { throw new Error("This read-only fixture must not change consent."); },
      check: async () => {
        checks++;
        await new Promise(resolve => setTimeout(resolve, 300));
        return { activation, health: checks === 1 ? "unavailable" : "healthy" };
      }
    };
  });
  await attachMockAgent(page, [], {}, { responseResults: {
    "context.runtime.doctor": { checkedAt: 1, status: { ...status, health: "unavailable", detail: "fetch failed" }, effectiveConfiguration: configuration, checks: [] },
    "context.config.get": configuration,
    "enterprise.identity.get": { state: "signed-out" }
  } });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("button", { name: "帮助与设置" }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "上下文与记忆", exact: true }).click();
  const settings = page.getByTestId("context-memory-settings");
  await expect(settings.getByText("本地服务运行中", { exact: true })).toBeVisible();
  await expect(settings.getByText("fetch failed", { exact: true })).toHaveCount(0);
  await expect(settings.getByLabel("OpenViking 服务地址")).toHaveCount(0);
  const reads = await recordedCommandDetails(page);
  expect(reads.filter(command => command.type === "context.status.get")).toHaveLength(0);
  expect(reads.find(command => command.type === "context.runtime.doctor")?.payload).toEqual({ probeRemote: false });
  await settings.getByRole("button", { name: "检测本地服务", exact: true }).click();
  await expect(settings.getByRole("button", { name: "正在检测…", exact: true })).toBeDisabled();
  await expect(settings.getByText(/本地进程仍在运行，但本次健康检测未通过/u)).toBeVisible();
  await settings.getByRole("button", { name: "检测本地服务", exact: true }).click();
  await expect(settings.getByText(/本次检测通过：当前本地服务可以连接/u)).toBeVisible();
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await settings.getByRole("button", { name: "检测本地服务", exact: true }).focus();
    await expect(settings.getByRole("button", { name: "检测本地服务", exact: true })).toBeFocused();
    await page.screenshot({ path: `artifacts/visual-review/managed-memory-health-${theme}.png`, animations: "disabled" });
  }
  await settings.getByRole("tab", { name: "高级", exact: true }).click();
  await expect(settings.getByText("兼容服务（手动地址）", { exact: true })).toBeVisible();
  await expect(settings.getByText("尚未检测", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "检测手动地址", exact: true }).click();
  await expect(settings.getByText("fetch failed", { exact: true })).toBeVisible();
  await settings.getByRole("tab", { name: "记忆与隐私", exact: true }).click();
  await expect(settings.getByText("本地服务运行中", { exact: true })).toBeVisible();
  await expect(settings.getByText("fetch failed", { exact: true })).toHaveCount(0);
});

test("memory settings preserve one draft across tabs, use keyboard radios, and guard navigation", async ({ page }) => {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page, [], {}, { responseResults: {
    "context.status.get": status,
    "context.runtime.doctor": { checkedAt: 1, status, effectiveConfiguration: configuration, checks: [] },
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
  await expect(settings.getByLabel("OpenViking 服务地址")).toHaveCount(0);
  await settings.getByRole("tab", { name: "团队经验" }).click();
  await settings.getByRole("textbox", { name: "New Money 服务地址" }).fill("https://memory.example.test");
  await settings.getByRole("tab", { name: "高级", exact: true }).click();
  await expect(settings.getByText("上下文参数", { exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "检测手动地址" })).toBeDisabled();
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
  await settings.getByRole("tab", { name: "高级", exact: true }).click();
  await expect(settings.getByRole("button", { name: "检测手动地址" })).toBeEnabled();
  await settings.getByRole("tab", { name: "团队经验" }).click();
  await expect(settings.getByRole("textbox", { name: "New Money 服务地址" })).toHaveValue("https://memory.example.test");
  await page.getByRole("button", { name: "返回工作台" }).click();
  await setMockAgentResponseResult(page, "context.session.commit", { kind: "accepted", operationId: "archive-test", cancellable: false });
  await setMockAgentResponseDelay(page, "context.session.commit", 300);
  await page.getByRole("tab", { name: "上下文", exact: true }).click();
  await page.getByRole("tab", { name: "记忆", exact: true }).click();
  const authority = await currentMockSessionAuthority(page);
  await page.getByRole("button", { name: "立即归档", exact: true }).click();
  await expect(page.getByRole("button", { name: "等待归档结果…", exact: true })).toBeDisabled();
  await expect(page.getByText("归档请求已受理，正在等待处理结果；这还不代表记忆抽取完成。", { exact: true })).toBeVisible();
  const archives = (await recordedCommandDetails(page)).filter((command) => command.type === "context.session.commit");
  expect(archives).toHaveLength(1);
  expect(archives[0]?.payload).toMatchObject({ sessionId: authority.sessionId, submissionId: expect.any(String) });
  expect(archives[0]?.context).toMatchObject({ scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id });
  await emitMockAgentEvent(page, { type: "context.commitCompleted", payload: {
    operationId: "archive-test", sessionId: authority.sessionId, outcome: "retained"
  } }, { context: "workspace" });
  const panel = page.getByTestId("memory-inspector");
  await expect(panel.getByRole("status")).toContainText("当前消息仍在最近对话保留范围内");
  await expect(panel.getByRole("button", { name: "立即归档", exact: true })).toBeEnabled();
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await panel.getByRole("button", { name: "立即归档", exact: true }).focus();
    await expect(panel.getByRole("button", { name: "立即归档", exact: true })).toBeFocused();
    await panel.screenshot({ path: `artifacts/visual-review/memory-archive-feedback-${theme}.png`, animations: "disabled" });
  }
  for (const [outcome, message] of [
    ["empty", "暂无可归档消息"], ["extracted", "本次归档的记忆处理已完成"],
    ["extraction-failed", "记忆处理未成功"], ["unconfirmed", "暂未确认记忆处理结果"]
  ] as const) {
    await setMockAgentResponseResult(page, "context.session.commit", { kind: "accepted", operationId: outcome, cancellable: false });
    await panel.getByRole("button", { name: "立即归档", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("归档请求已受理");
    await emitMockAgentEvent(page, { type: "context.commitCompleted", payload: { operationId: outcome, sessionId: authority.sessionId, outcome } }, { context: "workspace" });
    await expect(panel.getByRole("status")).toContainText(message);
    await expect(panel.getByRole("button", { name: "立即归档", exact: true })).toBeEnabled();
  }
});
