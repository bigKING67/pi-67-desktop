import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  replaceMockAgentHost
} from "./pi67-renderer-fixture.js";
import {
  armStaleSessionCatalogCursor,
  clearSessionCatalogRequests,
  emitSessionCatalogChanged,
  emitSessionCatalogSequenceGap,
  installSessionCatalogFixture,
  queueSessionCatalogRefresh,
  sessionCatalogRequests,
  updateSessionCatalogFixture,
  type FixtureSessionSummary
} from "./pi67-session-catalog-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("shows a cold rebuilding catalog and loads its first ready page", async ({ page }) => {
  await openCatalogWorkspace(page, {
    revision: 1,
    source: "sdk-fallback",
    state: "rebuilding",
    rebuilding: true,
    items: []
  });

  await expect(page.getByText("正在建立 Session 目录…")).toBeVisible();
  await expect(page.getByText(/Session 索引暂时不可用|Session 索引正在恢复/u)).toHaveCount(0);
  await expect.poll(async () => (await sessionCatalogRequests(page))[0]).toEqual({
    hostEpoch: 1,
    payload: { scope: "workspace", limit: 50, refresh: true }
  });

  await updateSessionCatalogFixture(page, {
    revision: 2,
    state: "ready",
    source: "sqlite",
    rebuilding: false,
    items: [session(1, "重建后的会话")]
  });
  await emitSessionCatalogChanged(page, 2);

  await expect(sessionButton(page, "重建后的会话")).toBeVisible();
  await expect(page.getByText("正在建立 Session 目录…")).toHaveCount(0);
});

test("uses a bounded first page, server search payload, and the bound next cursor", async ({ page }) => {
  const sessions = Array.from({ length: 65 }, (_value, index) => session(index + 1, `Catalog ${String(index + 1).padStart(2, "0")}`));
  sessions[54] = session(55, "服务端命中", "/workspace/hidden-folder");
  await openCatalogWorkspace(page, { items: sessions });

  await expect(sessionButton(page, "Catalog 01")).toBeVisible();
  await expect(page.getByRole("button", { name: "显示更多" })).toBeVisible();
  const [firstPage] = await sessionCatalogRequests(page);
  expect(firstPage?.payload).toEqual({ scope: "workspace", limit: 50, refresh: true });

  await clearSessionCatalogRequests(page);
  await page.getByRole("button", { name: "显示更多" }).click();
  await expect.poll(async () => (await sessionCatalogRequests(page)).length).toBeGreaterThanOrEqual(1);
  const [nextPage] = await sessionCatalogRequests(page);
  expect(nextPage?.payload).toEqual({
    scope: "workspace",
    limit: 50,
    cursor: {
      revision: 1,
      queryKey: "0".repeat(64),
      modifiedAt: sessions[49]!.modifiedAt,
      path: sessions[49]!.path
    }
  });

  await clearSessionCatalogRequests(page);
  await page.getByRole("searchbox", { name: "搜索会话" }).fill("hidden-folder");
  await expect.poll(async () => (await sessionCatalogRequests(page))[0]?.payload).toEqual({
    scope: "workspace",
    limit: 50,
    search: "hidden-folder"
  });
  await expect(sessionButton(page, "服务端命中")).toBeVisible();
  await expect(sessionButton(page, "Catalog 01")).toHaveCount(0);
});

test("invalidates pages on a revision event and applies explicit refresh data only to refresh requests", async ({ page }) => {
  await openCatalogWorkspace(page, { items: [session(1, "旧目录会话")] });
  await expect(sessionButton(page, "旧目录会话")).toBeVisible();
  await clearSessionCatalogRequests(page);

  await updateSessionCatalogFixture(page, { revision: 2, items: [session(2, "Revision 2 会话")] });
  await emitSessionCatalogChanged(page, 2, "session-updated");
  await expect(sessionButton(page, "Revision 2 会话")).toBeVisible();
  await expect(sessionButton(page, "旧目录会话")).toHaveCount(0);
  await expect.poll(async () => (await sessionCatalogRequests(page))[0]?.payload).toEqual({
    scope: "workspace",
    limit: 50
  });

  await queueSessionCatalogRefresh(page, { revision: 3, items: [session(3, "手动刷新会话")] });
  await clearSessionCatalogRequests(page);
  await page.getByRole("button", { name: "pi-demo 工作区菜单" }).click();
  await page.getByRole("menuitem", { name: "刷新会话" }).click();
  await expect.poll(async () => (await sessionCatalogRequests(page))
    .find((request) => request.payload.refresh === true)?.payload).toEqual({
    scope: "workspace",
    limit: 50,
    refresh: true
  });
  await expect(sessionButton(page, "手动刷新会话")).toBeVisible();
  await expect(sessionButton(page, "Revision 2 会话")).toHaveCount(0);
});

test("reloads the first page automatically after a stale next cursor", async ({ page }) => {
  const sessions = Array.from({ length: 65 }, (_value, index) => session(index + 1, `Stale ${String(index + 1).padStart(2, "0")}`));
  await openCatalogWorkspace(page, { items: sessions });
  await clearSessionCatalogRequests(page);
  await armStaleSessionCatalogCursor(page);

  await page.getByRole("button", { name: "显示更多" }).click();
  await expect.poll(async () => (await sessionCatalogRequests(page)).length).toBeGreaterThanOrEqual(2);
  const requests = await sessionCatalogRequests(page);
  expect(requests[0]?.payload.cursor).toBeDefined();
  expect(requests[1]?.payload).toEqual({ scope: "workspace", limit: 50 });
  await expect(page.getByText(/Session Catalog cursor is stale/u)).toHaveCount(0);
  await expect(sessionButton(page, "Stale 01")).toBeVisible();
});

test("resets catalog pages across a Host epoch and reloads without an old cursor", async ({ page }) => {
  await openCatalogWorkspace(page, { revision: 1, items: [session(1, "旧 Host 会话")] });
  await expect(sessionButton(page, "旧 Host 会话")).toBeVisible();

  await updateSessionCatalogFixture(page, { revision: 2, items: [session(2, "新 Host 会话")] });
  await clearSessionCatalogRequests(page);
  await replaceMockAgentHost(page, 2);

  await expect(sessionButton(page, "新 Host 会话")).toBeVisible();
  await expect(sessionButton(page, "旧 Host 会话")).toHaveCount(0);
  await expect.poll(async () => (await sessionCatalogRequests(page)).some((request) => (
    request.hostEpoch === 2 && request.payload.cursor === undefined
  ))).toBe(true);
});

test("replaces old pages after sequence-gap resync reports a ready revision", async ({ page }) => {
  await openCatalogWorkspace(page, { revision: 1, items: [session(1, "Resync 旧会话")] });
  await expect(sessionButton(page, "Resync 旧会话")).toBeVisible();

  await updateSessionCatalogFixture(page, {
    revision: 2,
    state: "ready",
    rebuilding: false,
    reconciledAt: 1_753_000_010_000,
    items: [session(2, "Resync 新会话")]
  });
  await clearSessionCatalogRequests(page);
  await emitSessionCatalogSequenceGap(page);

  await expect.poll(() => sessionCatalogRequests(page)).toEqual([{
    hostEpoch: 1,
    payload: { scope: "workspace", limit: 50 }
  }]);
  await expect(sessionButton(page, "Resync 新会话")).toBeVisible();
  await expect(sessionButton(page, "Resync 旧会话")).toHaveCount(0);
});

test("shows fallback, incomplete, and unavailable catalog states explicitly", async ({ page }) => {
  await openCatalogWorkspace(page, { revision: 1, items: [session(1, "健康状态会话")] });

  await updateSessionCatalogFixture(page, {
    revision: 2,
    source: "sdk-fallback",
    state: "fallback",
    degradedReason: "runtime-query",
    incomplete: true,
    skippedCount: 2
  });
  await emitSessionCatalogChanged(page, 2, "source-changed");
  await expect(page.getByText("Session 索引正在恢复，当前临时使用 Pi Session 扫描结果。")).toBeVisible();
  await expect(page.getByText("runtime-query", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/2 个 Session 无法读取/u)).toBeVisible();

  await updateSessionCatalogFixture(page, {
    revision: 3,
    source: "sqlite",
    state: "unavailable",
    incomplete: false,
    skippedCount: 0,
    items: []
  });
  await emitSessionCatalogChanged(page, 3, "source-changed");
  await expect(page.getByText("Session 目录暂不可用，可稍后刷新重试。")).toBeVisible();
  await expect(page.getByText("这个工作区还没有会话。")).toHaveCount(0);
});

test("keeps Command Palette server search independent from navigation search", async ({ page }) => {
  await openCatalogWorkspace(page, {
    items: [
      session(1, "导航结果", "/workspace/navigation-only"),
      session(2, "Palette 服务端结果", "/workspace/palette-only")
    ]
  });

  const navigationSearch = page.getByRole("searchbox", { name: "搜索会话" });
  await navigationSearch.fill("navigation-only");
  await expect(sessionButton(page, "导航结果")).toBeVisible();
  await clearSessionCatalogRequests(page);

  await page.getByRole("button", { name: "打开命令面板" }).click();
  const palette = page.getByRole("dialog", { name: "命令面板" });
  await palette.getByRole("combobox", { name: "搜索会话、扩展命令和应用操作" }).fill("palette-only");
  await expect.poll(async () => (await sessionCatalogRequests(page)).some((request) => (
    request.payload.search === "palette-only"
  ))).toBe(true);
  await expect(palette.getByRole("option", { name: /Palette 服务端结果/u })).toBeVisible();
  await expect(navigationSearch).toHaveValue("navigation-only");
});

async function openCatalogWorkspace(page: Page, options: Parameters<typeof installSessionCatalogFixture>[1]): Promise<void> {
  await page.goto("/");
  await attachMockAgent(page);
  await installSessionCatalogFixture(page, options);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByRole("button", { name: "pi-demo 工作区菜单" })).toBeVisible();
}

function session(index: number, name: string, cwd = "/workspace/catalog"): FixtureSessionSummary {
  return {
    id: `catalog-session-${index}`,
    path: `/sessions/catalog-${String(index).padStart(3, "0")}.jsonl`,
    cwd,
    name,
    modifiedAt: 1_753_000_000_000 - index * 1_000,
    messageCount: index
  };
}

function sessionButton(page: Page, name: string) {
  return page.getByTestId("conversation-row").filter({ hasText: name });
}
