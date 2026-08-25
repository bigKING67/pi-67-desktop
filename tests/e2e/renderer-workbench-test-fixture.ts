import { expect, type Locator, type Page } from "@playwright/test";
import {
  attachMockAgent,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommandDetails
} from "./pi67-renderer-fixture.js";
import type {
  MockDesktopBridgeOptions,
  MockWorkspaceDescriptor
} from "./pi67-renderer-desktop-bridge.js";
import type { MockAgentOptions } from "./pi67-renderer-fixture-types.js";
import type { FixtureSessionSummary } from "./pi67-session-catalog-fixture.js";

export async function openWorkbench(
  page: Page,
  bridgeOptions: MockDesktopBridgeOptions = {},
  agentOptions: MockAgentOptions = {}
): Promise<void> {
  await installMockDesktopBridge(page, bridgeOptions);
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    isolateTaskSnapshots: true,
    rotateSessionOnCreate: true,
    ...agentOptions
  });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).some((command) => command.type === "workspace.open" || command.type === "runtime.initialize"))
    .toBe(true);
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  await expect(page.getByRole("list", { name: "工作区与对话" })).toBeVisible();
}

export function workspaceGroup(page: Page, workspaceName: string): Locator {
  return page.getByRole("button", { name: `折叠工作区：${workspaceName}` })
    .locator("xpath=ancestor::section");
}

export function sessionSummary(
  workspace: MockWorkspaceDescriptor,
  index: number,
  name: string
): FixtureSessionSummary {
  return {
    id: `${workspace.id}-session-${index}`,
    fileIdentity: `session-file-fixture-${workspace.id}-${index}`,
    path: `/Users/test/.pi/agent/sessions/${workspace.id}-${index}.jsonl`,
    cwd: workspace.identity.canonicalPath,
    name,
    modifiedAt: 1_800_000_000_000 - index * 60_000,
    messageCount: index
  };
}

export async function markCurrentTaskRunning(
  page: Page,
  index: number,
  sessionId: string,
  sessionFileIdentity: string,
  sessionGeneration: number
): Promise<void> {
  const operationId = `operation-workbench-running-${index}`;
  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId,
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId,
        sessionFileIdentity,
        sessionGeneration,
        startedAt: Date.now()
      }
    }
  }, { operationId, sessionId, sessionFileIdentity, sessionGeneration });
}
