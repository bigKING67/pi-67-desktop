import { expect, test } from "@playwright/test";
import { createMockDeepSeekProviderConfigurationSnapshot } from "./pi67-provider-configuration-snapshot-fixture.js";
import { clearRecordedCommands, recordedCommandDetails, setMockAgentResponseFailure } from "./pi67-renderer-fixture.js";
import { openWorkbench } from "./renderer-workbench-test-fixture.js";

for (const stage of ["model.select", "thinking.set", "session.interactionMode.set"] as const) {
  test(`retries ${stage} after materialization without sending early or creating another Session`, async ({ page }) => {
    const configuration = createMockDeepSeekProviderConfigurationSnapshot(true);
    for (const provider of configuration.providers) for (const model of provider.models) {
      model.thinkingLevels = ["off", "high", "max"];
    }
    await openWorkbench(page, {}, { responseResults: { "provider.projectConfiguration.get": configuration } });
    await clearRecordedCommands(page);
    await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+n`);
    const model = page.getByRole("button", { name: "Pi 模型", exact: true });
    const thinking = page.getByRole("button", { name: "Pi 思考级别", exact: true });
    await model.click();
    await page.locator('[role="option"][data-key="deepseek/deepseek-v4-flash"]').click();
    await thinking.click();
    await page.getByRole("option", { name: "high", exact: true }).click();
    if (stage === "session.interactionMode.set") await page.getByRole("button", { name: "计划", exact: true }).click();
    await setMockAgentResponseFailure(page, stage, { code: "INTERNAL", message: "synthetic startup failure", recoverable: true });
    const composer = page.getByRole("textbox", { name: "给 Pi 发送消息" });
    await composer.fill("保留这条未发送的消息");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(async () => (await recordedCommandDetails(page)).filter(command => command.type === stage).length).toBe(1);
    await expect(model).toBeEnabled();
    expect((await recordedCommandDetails(page)).filter(command => command.type === "prompt.submit")).toHaveLength(0);
    await expect(composer).toHaveValue("保留这条未发送的消息");
    await expect(model).toContainText("DeepSeek V4 Flash");
    await expect(thinking).toContainText("high");
    await expect.poll(async () => page.evaluate(async () => {
      const { state } = await (window as unknown as { pi67: { system: import("../../packages/protocol/src/index.js").DesktopSystemBridge } }).pi67.system.loadComposerDraftState();
      return state.drafts.some(draft => draft.conversation.kind === "session" && draft.startupConfigurationPending === true);
    })).toBe(true);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(command => {
      delete (window as unknown as { __pi67TestAgent: { responseFailures: Record<string, unknown> } }).__pi67TestAgent.responseFailures[command];
    }, stage);
    // The failed draft remains editable; explicit replacement must win on retry.
    await model.click();
    await page.getByRole("option", { name: /^GPT Test/u }).click();
    await page.getByRole("button", { name: "执行", exact: true }).click();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(async () => (await recordedCommandDetails(page)).filter(command => command.type === "prompt.submit").length).toBe(1);
    const commands = await recordedCommandDetails(page);
    expect(commands.filter(command => command.type === "session.create")).toHaveLength(1);
    await expect(composer).toHaveValue("");
    await expect(model).toContainText("GPT Test");
    await expect.poll(async () => page.evaluate(async () => {
      const { state } = await (window as unknown as { pi67: { system: import("../../packages/protocol/src/index.js").DesktopSystemBridge } }).pi67.system.loadComposerDraftState();
      return state.drafts.some(draft => draft.startupConfigurationPending === true);
    })).toBe(false);
  });
}
