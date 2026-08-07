import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommandDetails,
  replaceMockAgentHost,
  setMockAgentResponseDelay,
  setMockAgentResponseFailure,
  setMockAgentResponseResult
} from "./pi67-renderer-fixture.js";
import {
  installSessionCatalogFixture,
  queueSessionCatalogRefresh,
  type FixtureSessionSummary
} from "./pi67-session-catalog-fixture.js";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";

test("rechecks an unknown create outcome by exact creation identity without submitting another Session", async ({ page }) => {
  await installMockDesktopBridge(page);
  const existing = session("existing", "已有对话", Date.now() - 60_000, 2, "explicit");
  await page.goto("/");
  await attachMockAgent(page);
  await installSessionCatalogFixture(page, { revision: 1, items: [existing] });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByTestId("conversation-row").filter({ hasText: existing.name })).toBeVisible();
  await clearRecordedCommands(page);
  await setMockAgentResponseFailure(page, "session.create", {
    code: "REQUEST_TIMEOUT",
    message: "Agent request acknowledgement timed out: session.create",
    recoverable: true
  });

  await page.getByRole("button", { name: "在 pi-demo 新建会话" }).click();
  await page.getByRole("textbox", { name: "给 Pi 发送消息" }).fill("触发未知创建结果");
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await expect(page.getByRole("heading", { name: "对话创建结果尚未确认" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新检查" })).toBeVisible();
  await expect(page.getByRole("button", { name: "放弃此占位" })).toBeVisible();
  await expect.poll(async () => (await recordedCommandDetails(page)).filter((command) => (
    command.type === "session.create"
  ))).toHaveLength(2);
  const creationId = creationIdFrom(await recordedCommandDetails(page));

  const created = session("created", "未命名对话", Date.now(), 0, "fallback");
  await setMockAgentResponseResult(page, "session.creation.resolve", {
    status: "materialized",
    creationId,
    sessionId: created.id,
    sessionFileIdentity: created.fileIdentity,
    sessionPath: created.path
  });
  await clearRecordedCommands(page);
  await page.getByRole("button", { name: "重新检查" }).click();

  await expect(page.getByRole("button", { name: "恢复任务" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新检查" })).toHaveCount(0);
  const recoveryCommands = await recordedCommandDetails(page);
  expect(recoveryCommands).toContainEqual(expect.objectContaining({
    type: "session.creation.resolve",
    payload: { creationId },
    context: { scope: "workspace", workspaceId: expect.any(String) }
  }));
  expect(recoveryCommands.some((command) => command.type === "session.catalog.query")).toBe(false);
  expect(recoveryCommands.some((command) => command.type === "session.create")).toBe(false);
});

test("recovers an unknown create across Host replacement without assigning the old Session to the provisional Task", async ({ page }) => {
  await installMockDesktopBridge(page);
  const existing = session("existing-host", "已有对话", Date.now() - 60_000, 2, "explicit");
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    isolateTaskSnapshots: true,
    sessionCatalogItems: [existing]
  });
  await installSessionCatalogFixture(page, { revision: 1, items: [existing] });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByTestId("conversation-row").filter({ hasText: existing.name })).toBeVisible();
  await clearRecordedCommands(page);
  await setMockAgentResponseDelay(page, "session.create", 60_000);

  await page.getByRole("button", { name: "在 pi-demo 新建会话" }).click();
  await page.getByRole("textbox", { name: "给 Pi 发送消息" }).fill("等待 Host replacement");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(async () => (await recordedCommandDetails(page)).filter((command) => (
    command.type === "session.create"
  ))).toHaveLength(1);
  const beforeReplacement = await recordedCommandDetails(page);
  const createCommand = beforeReplacement.find((command) => command.type === "session.create");
  const creationId = creationIdFrom(beforeReplacement);
  const provisionalTaskId = String(createCommand?.context?.taskId);
  const created = session("created-host", "Desktop 已确认对话", Date.now(), 0, "fallback");
  const tui = session("tui-host", "TUI 空对话", Date.now() + 1, 0, "fallback");
  await setMockAgentResponseResult(page, "session.creation.resolve", {
    status: "materialized",
    creationId,
    sessionId: created.id,
    sessionFileIdentity: created.fileIdentity,
    sessionPath: created.path
  });
  await queueSessionCatalogRefresh(page, { revision: 2, items: [tui, created, existing] });

  await replaceMockAgentHost(page, 2);

  await expect(page.getByRole("button", { name: "恢复任务" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新检查" })).toHaveCount(0);
  const commands = await recordedCommandDetails(page);
  const initialize = commands.find((command) => command.type === "runtime.initialize" && command.hostEpoch === 2);
  expect(initialize).toBeDefined();
  expect(initialize?.context?.taskId).not.toBe(provisionalTaskId);
  expect(initialize?.payload).toMatchObject({ sessionPath: expect.any(String) });
  expect(commands).toContainEqual(expect.objectContaining({
    type: "session.creation.resolve",
    hostEpoch: 2,
    payload: { creationId },
    context: { scope: "workspace", workspaceId: expect.any(String) }
  }));
  expect(commands.filter((command) => command.type === "session.create")).toEqual([
    expect.objectContaining({ hostEpoch: 1, payload: { creationId } })
  ]);
});

test("restores a persisted creation placeholder and reconciles it after the initial Host connection", async ({ page }) => {
  const taskId = "task-cold-creation";
  const creationId = "session-creation-cold-start";
  const created = session("cold-created", "冷启动恢复的对话", Date.now(), 0, "fallback");
  const tui = session("cold-tui", "TUI 空对话", Date.now() + 1, 0, "fallback");
  await installPersistedCreationBridge(page, taskId, creationId);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "对话创建结果尚未确认" })).toBeVisible();

  await attachMockAgent(page, [], {}, {
    sessionCatalogItems: [tui, created],
    responseResults: {
      "session.creation.resolve": {
        status: "materialized",
        creationId,
        sessionId: created.id,
        sessionFileIdentity: created.fileIdentity,
        sessionPath: created.path
      }
    }
  });

  await expect(page.getByRole("button", { name: "恢复任务" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新检查" })).toHaveCount(0);
  const commands = await recordedCommandDetails(page);
  expect(commands).toContainEqual(expect.objectContaining({
    type: "workspace.register",
    context: { scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  }));
  expect(commands).toContainEqual(expect.objectContaining({
    type: "session.creation.resolve",
    payload: { creationId },
    context: { scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  }));
  expect(commands.some((command) => command.type === "runtime.initialize")).toBe(false);
  expect(commands.some((command) => command.type === "session.create")).toBe(false);
});

test("reconciles a creation-only Workbench after Host replacement without inventing a recovery Session", async ({ page }) => {
  const taskId = "task-replacement-creation";
  const creationId = "session-creation-replacement-only";
  const created = session("replacement-created", "Host 重连恢复的对话", Date.now(), 0, "fallback");
  await installPersistedCreationBridge(page, taskId, creationId);
  await page.goto("/");
  await attachMockAgent(page, [], {}, { sessionCatalogItems: [created] });
  await expect(page.getByRole("button", { name: "重新检查" })).toBeVisible();
  await setMockAgentResponseResult(page, "session.creation.resolve", {
    status: "materialized",
    creationId,
    sessionId: created.id,
    sessionFileIdentity: created.fileIdentity,
    sessionPath: created.path
  });
  await clearRecordedCommands(page);

  await replaceMockAgentHost(page, 2);

  await expect(page.getByRole("button", { name: "恢复任务" })).toBeVisible();
  const commands = await recordedCommandDetails(page);
  expect(commands).toContainEqual(expect.objectContaining({
    type: "workspace.register",
    hostEpoch: 2,
    context: { scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  }));
  expect(commands).toContainEqual(expect.objectContaining({
    type: "session.creation.resolve",
    hostEpoch: 2,
    payload: { creationId }
  }));
  expect(commands.some((command) => command.type === "runtime.initialize")).toBe(false);
  expect(commands.some((command) => command.type === "session.create")).toBe(false);
});

function session(
  id: string,
  name: string,
  modifiedAt: number,
  messageCount: number,
  nameSource: NonNullable<FixtureSessionSummary["nameSource"]>
): FixtureSessionSummary {
  return {
    id: `catalog-session-${id}`,
    fileIdentity: `session-file-fixture-${id}`,
    path: `/sessions/catalog-${id}.jsonl`,
    cwd: "/workspace/catalog",
    name,
    nameSource,
    modifiedAt,
    messageCount
  };
}

function creationIdFrom(commands: Awaited<ReturnType<typeof recordedCommandDetails>>): string {
  const create = commands.find((command) => command.type === "session.create");
  const creationId = create?.payload && typeof create.payload === "object"
    ? (create.payload as { creationId?: unknown }).creationId
    : undefined;
  if (typeof creationId !== "string" || creationId.length === 0) {
    throw new Error("Expected a recorded session.create creationId.");
  }
  return creationId;
}

async function installPersistedCreationBridge(
  page: Parameters<typeof installMockDesktopBridge>[0],
  taskId: string,
  creationId: string
): Promise<void> {
  await installMockDesktopBridge(page, {
    initialWorkspaces: [DEFAULT_MOCK_WORKSPACE],
    initialSessionCreationRecovery: [{
      taskId,
      workspaceId: DEFAULT_MOCK_WORKSPACE.id,
      creationId,
      taskGeneration: 1
    }],
    expandedWorkspaceIds: [DEFAULT_MOCK_WORKSPACE.id],
    currentWorkspaceId: DEFAULT_MOCK_WORKSPACE.id,
    selectedSurface: {
      kind: "conversation",
      conversation: {
        kind: "provisional",
        workspaceId: DEFAULT_MOCK_WORKSPACE.id,
        draftId: taskId
      }
    }
  });
}
