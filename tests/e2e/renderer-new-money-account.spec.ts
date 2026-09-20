import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_CONTEXT_MEMORY_CONFIGURATION } from "../../packages/domain/src/index.js";
import { attachMockAgent, installMockDesktopBridge, recordedCommandDetails, setMockAgentResponseFailure, setMockAgentResponseResult } from "./pi67-renderer-fixture.js";

const signedIn = { state: "signed-in", userId: "synthetic-user", displayName: "New Money 测试账户" };
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
    await expect(footer).toContainText("已登录");
    await footer.focus(); await expect(footer).toBeFocused(); await page.keyboard.press("Enter");
    const account = page.getByTestId("new-money-account-settings");
    await expect(account).toContainText("New Money 测试账户");
    await expect(account.getByRole("button",{name:"退出登录",exact:true})).toBeEnabled();
    await expect(account.getByRole("textbox",{name:"New Money 服务地址"})).toBeDisabled();
    await expect(page.getByText("账户服务尚未接入",{exact:false})).toHaveCount(0);
    await page.screenshot({path:testInfo.outputPath(`account-${theme}.png`)});
    await page.getByRole("button",{name:"上下文与记忆",exact:true}).click();
    const memory = page.getByTestId("context-memory-settings");
    await memory.getByRole("tab",{name:"团队经验",exact:true}).click();
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
