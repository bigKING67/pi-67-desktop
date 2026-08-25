import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommandDetails,
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
  const initialRequests = await sessionCatalogRequests(page);
  expect(initialRequests).toHaveLength(1);
  const [firstPage] = initialRequests;
  expect(firstPage?.payload).toEqual({ scope: "workspace", limit: 50, refresh: true });

  await clearSessionCatalogRequests(page);
  await page.getByRole("button", { name: "显示更多" }).click();
  await expect.poll(async () => (await sessionCatalogRequests(page))
    .find((request) => request.payload.cursor !== undefined)?.payload).toEqual({
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
  await page.getByRole("searchbox", { name: "搜索对话" }).fill("hidden-folder");
  await expect.poll(async () => (await sessionCatalogRequests(page))
    .find((request) => request.payload.search === "hidden-folder")?.payload).toEqual({
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
  await page.getByRole("menuitem", { name: "刷新对话" }).click();
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
  await expect.poll(async () => {
    const requests = await sessionCatalogRequests(page);
    const staleCursorIndex = requests.findIndex((request) => request.payload.cursor !== undefined);
    if (staleCursorIndex < 0) return undefined;
    return requests.slice(staleCursorIndex + 1)
      .find((request) => request.payload.cursor === undefined)?.payload;
  }).toEqual({ scope: "workspace", limit: 50 });
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

  await expect.poll(async () => (await sessionCatalogRequests(page)).some((request) => (
    request.hostEpoch === 1
    && request.payload.scope === "workspace"
    && request.payload.limit === 50
    && request.payload.cursor === undefined
    && request.payload.refresh === undefined
  ))).toBe(true);
  await expect(sessionButton(page, "Resync 新会话")).toBeVisible();
  await expect(sessionButton(page, "Resync 旧会话")).toHaveCount(0);
  expect((await sessionCatalogRequests(page)).every((request) => request.payload.cursor === undefined)).toBe(true);
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

  const navigationSearch = page.getByRole("searchbox", { name: "搜索对话" });
  await navigationSearch.fill("navigation-only");
  await expect(sessionButton(page, "导航结果")).toBeVisible();
  await clearSessionCatalogRequests(page);

  await page.getByRole("button", { name: "打开命令面板" }).click();
  const palette = page.getByRole("dialog", { name: "命令面板" });
  await palette.getByRole("combobox", { name: "搜索对话标题、正文、扩展命令和应用操作" }).fill("palette-only");
  await expect.poll(async () => (await sessionCatalogRequests(page)).some((request) => (
    request.payload.search === "palette-only"
  ))).toBe(true);
  await expect(palette.getByRole("option", { name: /Palette 服务端结果/u })).toBeVisible();
  await expect(navigationSearch).toHaveValue("navigation-only");
});

test("renames the automatically opened catalog Session and restores its automatic title", async ({ page }) => {
  const automatic = {
    ...session(1, "检查冷启动标题"),
    nameSource: "seed" as const
  };
  await openCatalogWorkspace(page, { items: [automatic] });
  await expect(sessionButton(page, automatic.name)).toBeVisible();
  await clearRecordedCommands(page);

  await page.getByRole("button", { name: `${automatic.name} 对话菜单` }).click();
  await expect(page.getByRole("menuitem", { name: "停止任务" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "重命名对话" }).click();
  const renameDialog = page.getByRole("dialog", { name: "重命名对话" });
  await expect(renameDialog).toBeVisible();
  await expect(renameDialog.getByRole("button", { name: "恢复自动标题" })).toHaveCount(0);
  await renameDialog.getByRole("textbox", { name: "对话名称" }).fill("显式保留的标题");
  await updateSessionCatalogFixture(page, {
    revision: 2,
    items: [{ ...automatic, name: "显式保留的标题", nameSource: "explicit" }]
  });
  await renameDialog.getByRole("button", { name: "保存" }).click();

  await expect(sessionButton(page, "显式保留的标题")).toBeVisible();
  await expect.poll(async () => (await recordedCommandDetails(page)).find((command) => (
    command.type === "session.name"
  ))).toMatchObject({
    context: {
      scope: "task",
      workspaceId: "workspace-pi-demo",
      sessionFileIdentity: automatic.fileIdentity
    },
    payload: { mutation: { action: "set", name: "显式保留的标题" } }
  });

  await page.getByRole("button", { name: "显式保留的标题 对话菜单" }).click();
  await updateSessionCatalogFixture(page, { revision: 3, items: [automatic] });
  await page.getByRole("menuitem", { name: "恢复自动标题" }).click();
  await expect(sessionButton(page, automatic.name)).toBeVisible();
  await expect.poll(async () => (await recordedCommandDetails(page)).filter((command) => (
    command.type === "session.name"
  )).at(-1)).toMatchObject({
    context: {
      scope: "task",
      workspaceId: "workspace-pi-demo",
      sessionFileIdentity: automatic.fileIdentity
    },
    payload: { mutation: { action: "clear" } }
  });
});

test("pins a conversation ahead of newer unpinned history", async ({ page }) => {
  const newer = session(1, "较新的普通对话");
  const pinned = session(2, "需要置顶的对话");
  await openCatalogWorkspace(page, { items: [newer, pinned] });
  await expect(page.getByTestId("conversation-row").first()).toContainText(newer.name);
  await clearRecordedCommands(page);

  await page.getByRole("button", { name: `${pinned.name} 对话菜单` }).click();
  await page.getByRole("menuitem", { name: "置顶对话" }).click();
  await expect.poll(async () => (await recordedCommandDetails(page)).find((command) => (
    command.type === "conversation.pin"
  ))).toMatchObject({ payload: { path: pinned.path, pinned: true } });
  await updateSessionCatalogFixture(page, {
    revision: 2,
    items: [newer, { ...pinned, pinnedAt: 1_900_000_000_000 }]
  });
  await emitSessionCatalogChanged(page, 2, "session-updated");

  await expect(page.getByTestId("conversation-row").first()).toContainText(pinned.name);
  await page.getByRole("button", { name: `${pinned.name} 对话菜单` }).click();
  await expect(page.getByRole("menuitem", { name: "取消置顶" })).toBeVisible();
});

test("executes /name with an argument and opens the same rename dialog without one", async ({ page }) => {
  const original = session(1, "Slash 命名前");
  await openCatalogWorkspace(page, { items: [original] });
  await sessionButton(page, original.name).click();
  const composer = page.getByRole("textbox", { name: "给 Pi 发送消息" });
  await expect(composer).toBeVisible();
  await clearRecordedCommands(page);

  await updateSessionCatalogFixture(page, {
    revision: 2,
    items: [{ ...original, name: "Slash 命名后", nameSource: "explicit" }]
  });
  await composer.fill("/name Slash 命名后");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect.poll(async () => (await recordedCommandDetails(page)).find((command) => (
    command.type === "session.name"
  ))).toMatchObject({ payload: { mutation: { action: "set", name: "Slash 命名后" } } });
  await expect(sessionButton(page, "Slash 命名后")).toBeVisible();

  await composer.fill("/name");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect(page.getByRole("dialog", { name: "重命名对话" })).toBeVisible();
});

test("archives an active Session after releasing its Runtime and restores it without deleting Pi history", async ({ page }) => {
  const active = session(1, "可归档对话");
  await openCatalogWorkspace(page, { items: [active] });
  await clearRecordedCommands(page);

  await page.getByRole("button", { name: `${active.name} 对话菜单` }).click();
  await page.getByRole("menuitem", { name: "归档对话" }).click();
  await expect.poll(async () => (await recordedCommandDetails(page)).find((command) => (
    command.type === "conversation.archive"
  ))).toMatchObject({ payload: { path: active.path, archived: true } });
  await updateSessionCatalogFixture(page, {
    revision: 2,
    items: [{ ...active, archivedAt: 1_900_000_000_000 }]
  });
  await emitSessionCatalogChanged(page, 2, "session-updated");

  await expect(sessionButton(page, active.name)).toHaveCount(0);
  await expect(page.getByText("对话已归档", { exact: true })).toBeVisible();
  await expect.poll(async () => (await recordedCommandDetails(page)).find((command) => (
    command.type === "task.close"
  ))).toMatchObject({
    context: {
      scope: "task",
      workspaceId: "workspace-pi-demo",
      sessionFileIdentity: active.fileIdentity
    },
    payload: { mode: "dispose" }
  });

  await page.getByRole("button", { name: "撤销" }).click();
  await expect.poll(async () => (await recordedCommandDetails(page)).filter((command) => (
    command.type === "conversation.archive"
  )).at(-1)).toMatchObject({ payload: { path: active.path, archived: false } });
  await updateSessionCatalogFixture(page, { revision: 3, items: [active] });
  await emitSessionCatalogChanged(page, 3, "session-updated");
  await expect(sessionButton(page, active.name)).toBeVisible();
});

test("searches archived conversations and supports restore plus restore-and-open", async ({ page }) => {
  const active = session(1, "当前对话");
  const archivedA = { ...session(2, "归档设计检查"), archivedAt: 1_900_000_000_000 };
  const archivedB = { ...session(3, "归档发布检查"), archivedAt: 1_800_000_000_000 };
  await openCatalogWorkspace(page, { items: [active, archivedA, archivedB] });
  await page.getByRole("button", { name: "pi-demo 工作区菜单" }).click();
  await page.getByRole("menuitem", { name: "已归档对话" }).click();
  const dialog = page.getByRole("dialog", { name: "已归档对话：pi-demo" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(archivedA.name, { exact: true })).toBeVisible();
  await expect(dialog).toContainText(/归档于.*最后修改/u);

  await clearSessionCatalogRequests(page);
  await dialog.getByRole("textbox", { name: "搜索已归档对话" }).fill("设计检查");
  await expect.poll(async () => (await sessionCatalogRequests(page)).at(-1)?.payload).toMatchObject({
    scope: "workspace",
    view: "archived",
    search: "设计检查"
  });
  await expect(dialog.getByText(archivedA.name, { exact: true })).toBeVisible();
  await expect(dialog.getByText(archivedB.name, { exact: true })).toHaveCount(0);

  await dialog.getByRole("button", { name: "恢复", exact: true }).click();
  await expect.poll(async () => (await recordedCommandDetails(page)).find((command) => (
    command.type === "conversation.archive"
  ))).toMatchObject({ payload: { path: archivedA.path, archived: false } });
  await updateSessionCatalogFixture(page, { revision: 2, items: [active, session(2, archivedA.name), archivedB] });
  await emitSessionCatalogChanged(page, 2, "session-updated");
  await expect(sessionButton(page, archivedA.name)).toBeVisible();
  await expect(dialog.getByText(archivedA.name, { exact: true })).toHaveCount(0);

  await dialog.getByRole("textbox", { name: "搜索已归档对话" }).fill("");
  await expect(dialog.getByText(archivedB.name, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "恢复并打开" }).click();
  await expect.poll(async () => (await recordedCommandDetails(page)).filter((command) => (
    command.type === "conversation.archive"
  )).at(-1)).toMatchObject({ payload: { path: archivedB.path, archived: false } });
  await updateSessionCatalogFixture(page, {
    revision: 3,
    items: [active, session(2, archivedA.name), session(3, archivedB.name)]
  });
  await emitSessionCatalogChanged(page, 3, "session-updated");
  await expect(dialog).toHaveCount(0);
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
    fileIdentity: `session-file-fixture-${index}`,
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
