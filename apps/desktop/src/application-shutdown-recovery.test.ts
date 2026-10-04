import { afterEach, expect, it, vi } from "vitest";
import { createApplicationShutdownController } from "./application-shutdown.js";
import { addOrRefreshWorkspace, beginWorkbenchRun, finishWorkbenchRun, replaceWorkbenchLayout } from "./workbench-state.js";
import { cleanupWorkbenchStateTestRoots, temporaryWorkbenchStateRoot, workbenchDescriptorFixture,
  workbenchRecoveryRecord, workbenchStateTestStore } from "./workbench-state-test-fixture.js";

afterEach(async () => { vi.useRealTimers(); await cleanupWorkbenchStateTestRoots(); });

it.each([
  { outcome: { graceful: false, forced: true }, clean: false },
  { outcome: { graceful: false, forced: false }, clean: false },
  { outcome: { graceful: true, forced: true }, clean: false },
  { outcome: undefined, clean: false },
  { outcome: { graceful: true, forced: false }, clean: true }
])("clears durable task recovery only after confirmed graceful shutdown: %j", async ({ outcome, clean }) => {
  const root = await temporaryWorkbenchStateRoot();
  const store = workbenchStateTestStore(root);
  const workspace = workbenchDescriptorFixture("workspace-1", "/synthetic-workspace");
  const conversation = { kind: "session" as const, workspaceId: workspace.id,
    sessionFileIdentity: "session-file-1", sessionPath: "/synthetic-sessions/task.jsonl" };
  await store.update(state => replaceWorkbenchLayout(addOrRefreshWorkspace(state, workspace).state, {
    currentWorkspaceId: workspace.id,
    expandedWorkspaceIds: [workspace.id],
    selectedSurface: { kind: "conversation", conversation },
    runtimeRecovery: [workbenchRecoveryRecord("active-task", conversation)],
    sessionCreationRecovery: [], settings: { section: "general", scope: "global" }
  }));
  const afterAgentHostStop = vi.fn(async () => undefined);
  const quit = vi.fn();
  const controller = createApplicationShutdownController({
    checkpointRenderer: async () => true,
    stopAgentHost: async () => outcome,
    afterAgentHostStop,
    markCleanExit: async () => { await store.update(finishWorkbenchRun); },
    quit
  });
  controller.handleBeforeQuit({ preventDefault: vi.fn() });
  await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
  expect(afterAgentHostStop).toHaveBeenCalledOnce();

  const persisted = (await workbenchStateTestStore(root).load()).state;
  expect(persisted.cleanExit).toBe(clean);
  expect(beginWorkbenchRun(persisted).runtimeRecovery).toEqual(clean ? [] : [
    expect.objectContaining({ taskId: "active-task", conversation, lastKnownLifecycle: "lost" })
  ]);
});

it("does not clear recovery on a late graceful result after the quit watchdog", async () => {
  vi.useFakeTimers();
  let finishStop!: (value: { graceful: boolean; forced: boolean }) => void;
  const markCleanExit = vi.fn(async () => undefined);
  const afterAgentHostStop = vi.fn(async () => undefined);
  const quit = vi.fn();
  const controller = createApplicationShutdownController({
    stopAgentHost: () => new Promise(resolve => { finishStop = resolve; }),
    markCleanExit, afterAgentHostStop, quit,
    shutdownBudgetMs: 1_000, rendererCheckpointBudgetMs: 200, finalizationReserveMs: 200
  });
  controller.handleBeforeQuit({ preventDefault: vi.fn() });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(quit).toHaveBeenCalledOnce();
  finishStop({ graceful: true, forced: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(markCleanExit).not.toHaveBeenCalled();
  expect(afterAgentHostStop).not.toHaveBeenCalled();
  expect(quit).toHaveBeenCalledOnce();
});
