import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_CONTEXT_MEMORY_CONFIGURATION } from "../../packages/domain/src/index.js";
import { attachMockAgent, installMockDesktopBridge, recordedCommandDetails, setMockAgentResponseFailure, setMockAgentResponseResult } from "./pi67-renderer-fixture.js";

const signedIn = { state: "signed-in", userId: "synthetic-user", displayName: "New Money 测试账户" };
// A rare CI failure shows sign-out reverting to signed-in; keep the account
// request/response order (types and states only) when any account test fails.
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const exchanges = await page.evaluate(() => (
    window as unknown as { __pi67TestAgent?: { accountExchanges?: unknown[] } }
  ).__pi67TestAgent?.accountExchanges ?? []).catch(() => []);
  const log = JSON.stringify(exchanges);
  console.log(`Account exchanges for "${testInfo.title}": ${log}`);
  await testInfo.attach("account-exchanges", { body: log, contentType: "application/json" });
});
async function setup(page: Page, identity: object = signedIn) {
  const configuration = { ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION, revision: "account-fixture", enterpriseGatewayEndpoint: "https://newmoney.example.test" };
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page, [], {}, { responseResults: {
    "enterprise.identity.get": identity,
    "context.config.get": configuration,
    "context.runtime.doctor": { checkedAt: 1, effectiveConfiguration: configuration, checks: [], status: {
      provider: "openviking", health: "degraded", owner: "pi67-openviking", effectivePrivacyMode: "private-learning",
      endpoint: configuration.endpoint, configured: true, conflictExtensions: [], lastCheckedAt: 1
    } },
    "enterprise.team.list": {items: [], total: 0},
    "enterprise.auth.disconnect": {state:"signed-out"},
    "enterprise.auth.begin": {authorizationId:"synthetic-auth",verificationUri:"https://newmoney.example.test/device",userCode:"TEST-CODE",expiresAt:Date.now()+60000,intervalSeconds:1},
    "enterprise.auth.poll": signedIn
  } });
  await page.getByRole("button", {name:"选择工作区",exact:true}).click();
}
for (const theme of ["light", "dark"] as const) {
  test(`shared identity and account navigation in ${theme}`, async ({page}, testInfo) => {
    await page.addInitScript(value => localStorage.setItem("pi67.themePreference",value),theme);
    await setup(page);
    const footer = page.getByTestId("account-settings-entry");
    await expect(footer).toContainText("New Money 测试账户");
    await expect(footer).toHaveAccessibleName("New Money 测试账户，已登录 · 账户与团队");
    await expect(footer).not.toContainText("已登录");
    await expect(footer.getByText("N", { exact: true })).toBeVisible();
    await footer.focus(); await expect(footer).toBeFocused(); await page.keyboard.press("Enter");
    const account = page.getByTestId("new-money-account-settings");
    await expect(account).toContainText("New Money 测试账户");
    await expect(account.getByRole("button",{name:"退出登录",exact:true})).toBeEnabled();
    await expect(account.getByRole("textbox",{name:"New Money 服务地址"})).toBeHidden();
    await account.locator("summary").filter({ hasText: "高级连接设置" }).click();
    await expect(account.getByRole("textbox",{name:"New Money 服务地址"})).toBeDisabled();
    await expect(page.getByText("账户服务尚未接入",{exact:false})).toHaveCount(0);
    await page.screenshot({path:testInfo.outputPath(`account-${theme}.png`)});
    await account.getByRole("button",{name:"团队经验设置",exact:true}).click();
    const memory = page.getByTestId("context-memory-settings");
    await expect(memory.getByRole("tab",{name:"团队经验",exact:true})).toHaveAttribute("aria-selected", "true");
    await expect(memory).toContainText("New Money 测试账户");
    await expect(memory.getByRole("button",{name:"连接 New Money",exact:true})).toHaveCount(0);
    await memory.getByRole("button",{name:"账户与登录设置"}).click();
    await expect(account).toBeVisible();
    await setMockAgentResponseResult(page,"enterprise.identity.get",{state:"signed-out"});
    await account.getByRole("button",{name:"退出登录",exact:true}).click();
    await expect(account.getByRole("button",{name:"登录 New Money",exact:true})).toBeEnabled();
    await page.getByRole("button",{name:"返回工作台"}).click();
    await expect(footer).toContainText("登录 New Money");
    expect((await recordedCommandDetails(page)).some(x=>x.type==="enterprise.knowledge.index")).toBe(false);
  });
}
test("device login publishes its result to the footer without a separate memory login", async ({page}) => {
  await setup(page,{state:"signed-out"});
  await page.getByTestId("account-settings-entry").click();
  const account = page.getByTestId("new-money-account-settings");
  await account.getByRole("button",{name:"登录 New Money",exact:true}).click();
  await expect(account).toContainText("TEST-CODE");
  await setMockAgentResponseResult(page,"enterprise.identity.get",signedIn);
  await expect(account.getByRole("button",{name:"退出登录",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"返回工作台"}).click();
  await expect(page.getByTestId("account-settings-entry")).toContainText("New Money 测试账户");
});
test("a transient polling failure clears once device authorization succeeds", async ({page}) => {
  await setup(page,{state:"signed-out"});
  await setMockAgentResponseFailure(page,"enterprise.auth.poll",{code:"INTERNAL",message:"Synthetic poll offline",recoverable:true});
  await page.getByTestId("account-settings-entry").click();
  const account = page.getByTestId("new-money-account-settings");
  await account.getByRole("button",{name:"登录 New Money",exact:true}).click();
  await expect(account.getByRole("alert")).toContainText("暂时无法检查授权结果");
  await page.evaluate(() => {
    delete (window as unknown as { __pi67TestAgent: { responseFailures: Record<string, unknown> } })
      .__pi67TestAgent.responseFailures["enterprise.auth.poll"];
  });
  await setMockAgentResponseResult(page,"enterprise.identity.get",signedIn);
  await expect(account.getByRole("button",{name:"退出登录",exact:true})).toBeEnabled();
  await expect(account.getByText("暂时无法检查授权结果", { exact: false })).toHaveCount(0);
});
test("identity read errors remain unconfirmed instead of becoming logged out", async ({page}) => {
  await setup(page);
  await page.getByTestId("account-settings-entry").click();
  await setMockAgentResponseFailure(page,"enterprise.identity.get",{code:"RUNTIME_NOT_READY",message:"Synthetic offline",recoverable:false});
  await page.getByRole("button",{name:"刷新状态",exact:true}).click();
  await expect(page.getByTestId("new-money-account-settings")).toContainText("账户状态待确认");
});

test("explicit refresh fetches the profile and updates the shared footer name", async ({page}) => {
  await setup(page);
  await page.getByTestId("account-settings-entry").click();
  const account = page.getByTestId("new-money-account-settings");
  await expect(account).toContainText("New Money 测试账户");
  await setMockAgentResponseResult(page, "enterprise.identity.get", { ...signedIn, displayName: "whois67" });
  await account.getByRole("button", { name: "刷新状态", exact: true }).click();
  await expect(account).toContainText("whois67");
  expect((await recordedCommandDetails(page)).some(x => x.type === "enterprise.identity.get"
    && (x.payload as { refresh?: boolean }).refresh === true)).toBe(true);
  await page.getByRole("button", { name: "返回工作台" }).click();
  await expect(page.getByTestId("account-settings-entry")).toContainText("whois67");
});

test("team deep link protects an unsaved service address and clears its target", async ({ page }) => {
  await setup(page, { state: "signed-out" });
  await page.getByTestId("account-settings-entry").click();
  const account = page.getByTestId("new-money-account-settings");
  const advanced = account.locator("details");
  await advanced.locator("summary").click();
  const address = account.getByRole("textbox", { name: "New Money 服务地址" });
  await address.fill("https://draft.example.test");
  await advanced.locator("summary").click();
  await expect(advanced).toHaveAttribute("open", "");
  const link = account.getByRole("button", { name: "团队经验设置", exact: true });
  await link.click();
  const dialog = page.getByRole("dialog", { name: "放弃未保存的修改" });
  await dialog.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(address).toHaveValue("https://draft.example.test");
  await expect(link).toBeFocused();
  await link.click();
  await dialog.getByRole("button", { name: "放弃修改并离开", exact: true }).click();
  await expect(page.getByRole("tab", { name: "团队经验", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "外观与通知", exact: true }).click();
  await page.getByRole("button", { name: "上下文与记忆", exact: true }).click();
  await expect(page.getByRole("tab", { name: "记忆与隐私", exact: true })).toHaveAttribute("aria-selected", "true");
  expect((await recordedCommandDetails(page)).some(command => command.type === "context.config.update")).toBe(false);
});

for (const theme of ["light", "dark"] as const) {
  for (const section of ["账户与数据", "上下文与记忆"] as const) {
    test(`retries an initial configuration failure in ${section} without writes in ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(value => localStorage.setItem("pi67.themePreference", value), theme);
      await setup(page, { state: "signed-out" });
      await setMockAgentResponseFailure(page, "context.config.get", { code: "RUNTIME_NOT_READY", message: "Synthetic configuration offline", recoverable: false });
      await page.getByTestId("account-settings-entry").click();
      if (section === "上下文与记忆") await page.getByRole("button", { name: section, exact: true }).click();
      const settings = page.getByTestId("settings-workbench");
      const retry = settings.getByRole("button", { name: section === "账户与数据" ? "重试读取配置" : "重试读取设置", exact: true });
      await expect(retry).toBeEnabled();
      await retry.focus();
      await page.screenshot({ path: testInfo.outputPath(`retry-${theme}-${section}.png`) });
      await page.evaluate(() => {
        const state = (window as unknown as { __pi67TestAgent: { responseFailures: Record<string, unknown>; responseDelays: Record<string, number> } }).__pi67TestAgent;
        delete state.responseFailures["context.config.get"];
        state.responseDelays["context.config.get"] = 350;
      });
      const readsBefore = (await recordedCommandDetails(page)).filter(command => command.type === "context.config.get").length;
      await page.keyboard.press("Enter");
      await expect(retry).toBeHidden();
      if (section === "账户与数据") {
        await expect(settings.getByRole("button", { name: "登录 New Money", exact: true })).toBeEnabled();
        await expect(settings.getByRole("textbox", { name: "New Money 服务地址" })).toHaveValue("https://newmoney.example.test");
      } else {
        await expect(settings.getByRole("radio")).toHaveCount(4);
        await expect(settings.getByRole("button", { name: "保存更改", exact: true })).toHaveCount(0);
      }
      const commands = await recordedCommandDetails(page);
      expect(commands.filter(command => command.type === "context.config.get")).toHaveLength(readsBefore + 1);
      expect(commands.filter(command => command.type === "context.config.update" || command.type === "enterprise.auth.begin")).toHaveLength(0);
      expect(commands.filter(command => command.type === "context.runtime.doctor").every(command => (command.payload as { probeRemote?: boolean }).probeRemote === false)).toBe(true);
    });
  }
}
