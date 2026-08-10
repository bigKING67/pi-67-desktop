import type { AgentRuntime, PiWorkspaceRuntimeServices } from "@pi67/pi-runtime";
import type { SkillPackListResult, SkillPackMutationResult } from "@pi67/domain";
import type { AgentCommand, WorkspaceProtocolContext } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import { ResourceManagementCoordinator } from "./resource-management-coordinator.js";
import {
  SkillPackCommandRouter,
  type SkillPackCommandType
} from "./skill-pack-command-router.js";
import type { SkillPackManagementPort } from "./skill-pack-management.js";

const WORKSPACE: WorkspaceProtocolContext = { scope: "workspace", workspaceId: "workspace-skills" };
const EMPTY: SkillPackListResult = { items: [], total: 0 };
const UPDATED: SkillPackMutationResult = { items: [], total: 0, changed: true };

describe("SkillPackCommandRouter", () => {
  it("routes queries and requires an idempotency key for the global mutation", async () => {
    const management = {
      list: vi.fn(async () => EMPTY),
      checkForUpdates: vi.fn(async () => EMPTY),
      beginUpdate: vi.fn(async () => transaction(UPDATED)),
      beginRestore: vi.fn(async () => transaction(UPDATED))
    };
    const router = createRouter(management);

    await expect(router.dispatch(WORKSPACE, command("skill.pack.list", {}))).resolves.toEqual(EMPTY);
    await expect(router.dispatch(WORKSPACE, command("skill.pack.checkUpdates", {}))).resolves.toEqual(EMPTY);
    await expect(router.dispatch(WORKSPACE, command("skill.pack.install", { id: "lark-cli-global" })))
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(router.dispatch(WORKSPACE, command("skill.pack.update", { id: "lark-cli-global" })))
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("fences every Task during update, reloads resources, and replays the result", async () => {
    let finishUpdate!: () => void;
    const update = vi.fn(() => new Promise<ReturnType<typeof transaction>>((resolve) => {
      finishUpdate = () => resolve(transaction(UPDATED));
    }));
    const runtimeA = runtime();
    const runtimeB = runtime();
    const tasks = [task("workspace-a", runtimeA.runtime), task("workspace-b", runtimeB.runtime)];
    const coordinator = new ResourceManagementCoordinator({ listTasks: () => tasks });
    const router = createRouter({
      list: async () => EMPTY,
      checkForUpdates: async () => EMPTY,
      beginUpdate: update,
      beginRestore: async () => transaction(UPDATED)
    }, coordinator);

    const updateCommand = command("skill.pack.update", { id: "lark-cli-global" });
    const pending = router.dispatch(WORKSPACE, updateCommand, "update-lark");
    const replay = router.dispatch(WORKSPACE, updateCommand, "update-lark");
    expect(() => coordinator.assertTaskCommandAllowed("workspace-a"))
      .toThrow(expect.objectContaining({ code: "BUSY" }));

    await Promise.resolve();
    finishUpdate();
    await expect(Promise.all([pending, replay])).resolves.toEqual([UPDATED, UPDATED]);
    expect(update).toHaveBeenCalledOnce();
    expect(runtimeA.reloadResources).toHaveBeenCalledOnce();
    expect(runtimeB.reloadResources).toHaveBeenCalledOnce();
  });

  it("blocks a global Lark CLI install while any Pi Task is active", async () => {
    const install = vi.fn(async () => transaction(UPDATED));
    const coordinator = new ResourceManagementCoordinator({
      listTasks: () => [{
        taskKey: "workspace-a:active-task",
        workspaceId: "workspace-a",
        runtime: undefined,
        initialized: false,
        isIdle: () => false
      }]
    });
    const router = createRouter({
      list: async () => EMPTY,
      checkForUpdates: async () => EMPTY,
      beginInstall: install,
      beginUpdate: async () => transaction(UPDATED),
      beginRestore: async () => transaction(UPDATED)
    }, coordinator);

    await expect(router.dispatch(
      WORKSPACE,
      command("skill.pack.install", { id: "lark-cli-global" }),
      "install-lark-while-busy"
    )).rejects.toMatchObject({ code: "BUSY", details: { scope: "global" } });
    expect(install).not.toHaveBeenCalled();
  });

  it("shares the resource coordinator with package queries", async () => {
    let finishQuery!: () => void;
    const coordinator = new ResourceManagementCoordinator({ listTasks: () => [] });
    const router = createRouter({
      list: async () => EMPTY,
      checkForUpdates: () => new Promise((resolve) => { finishQuery = () => resolve(EMPTY); }),
      beginUpdate: async () => transaction(UPDATED),
      beginRestore: async () => transaction(UPDATED)
    }, coordinator);

    const query = router.dispatch(WORKSPACE, command("skill.pack.checkUpdates", {}));
    await Promise.resolve();
    await expect(router.dispatch(
      WORKSPACE,
      command("skill.pack.update", { id: "lark-cli-global" }),
      "update-during-query"
    )).rejects.toMatchObject({ code: "BUSY" });
    finishQuery();
    await query;
  });

  it("rolls the mutation back and reloads the restored resources when activation reload fails", async () => {
    const commit = vi.fn(async () => undefined);
    const rollback = vi.fn(async () => undefined);
    const reloadResources = vi.fn()
      .mockRejectedValueOnce(new Error("reload failed"))
      .mockResolvedValueOnce({
        sessionId: "session-skills",
        controls: { thinkingLevel: "off" },
        modelCatalog: { models: [], providers: [], availableThinkingLevels: [] },
        resources: []
      });
    const coordinator = new ResourceManagementCoordinator({
      listTasks: () => [task("workspace-a", { reloadResources } as unknown as AgentRuntime)]
    });
    const router = createRouter({
      list: async () => EMPTY,
      checkForUpdates: async () => EMPTY,
      beginUpdate: async () => ({ result: UPDATED, commit, rollback }),
      beginRestore: async () => transaction(UPDATED)
    }, coordinator);

    await expect(router.dispatch(
      WORKSPACE,
      command("skill.pack.update", { id: "ai-berkshire-investment-suite" }),
      "update-ai-berkshire"
    )).rejects.toThrow("reload failed");
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();
    expect(reloadResources).toHaveBeenCalledTimes(2);
  });

  it("rolls back and reloads restored resources when transaction finalization fails", async () => {
    const commitError = new Error("backup cleanup failed");
    const commit = vi.fn(async () => { throw commitError; });
    const rollback = vi.fn(async () => undefined);
    const activeRuntime = runtime();
    const coordinator = new ResourceManagementCoordinator({
      listTasks: () => [task("workspace-a", activeRuntime.runtime)]
    });
    const router = createRouter({
      list: async () => EMPTY,
      checkForUpdates: async () => EMPTY,
      beginUpdate: async () => ({ result: UPDATED, commit, rollback }),
      beginRestore: async () => transaction(UPDATED)
    }, coordinator);

    await expect(router.dispatch(
      WORKSPACE,
      command("skill.pack.update", { id: "ai-berkshire-investment-suite" }),
      "update-ai-berkshire-commit-failure"
    )).rejects.toBe(commitError);
    expect(commit).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledOnce();
    expect(activeRuntime.reloadResources).toHaveBeenCalledTimes(2);
  });

  it("reports a failed rollback without masking the original reload failure", async () => {
    const reloadError = new Error("reload failed");
    const rollbackError = new Error("rollback failed");
    const rollback = vi.fn(async () => { throw rollbackError; });
    const reloadResources = vi.fn(async () => { throw reloadError; });
    const coordinator = new ResourceManagementCoordinator({
      listTasks: () => [task("workspace-a", { reloadResources } as unknown as AgentRuntime)]
    });
    const router = createRouter({
      list: async () => EMPTY,
      checkForUpdates: async () => EMPTY,
      beginUpdate: async () => ({ result: UPDATED, commit: vi.fn(), rollback }),
      beginRestore: async () => transaction(UPDATED)
    }, coordinator);

    const failure = await router.dispatch(
      WORKSPACE,
      command("skill.pack.update", { id: "ai-berkshire-investment-suite" }),
      "update-ai-berkshire-rollback-failure"
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "RUNTIME_POISONED",
      recoverable: false,
      details: { recoveryStage: "rollback", resourceStateConsistent: false }
    });
    expect(failure).toHaveProperty("cause", expect.any(AggregateError));
    expect((failure as Error & { cause: AggregateError }).cause.errors).toEqual([reloadError, rollbackError]);
    expect(reloadResources).toHaveBeenCalledOnce();
  });

  it("reports when restored resources cannot be reloaded after a successful rollback", async () => {
    const firstReloadError = new Error("activation reload failed");
    const restoredReloadError = new Error("restored reload failed");
    const rollback = vi.fn(async () => undefined);
    const reloadResources = vi.fn()
      .mockRejectedValueOnce(firstReloadError)
      .mockRejectedValueOnce(restoredReloadError);
    const coordinator = new ResourceManagementCoordinator({
      listTasks: () => [task("workspace-a", { reloadResources } as unknown as AgentRuntime)]
    });
    const router = createRouter({
      list: async () => EMPTY,
      checkForUpdates: async () => EMPTY,
      beginUpdate: async () => ({ result: UPDATED, commit: vi.fn(), rollback }),
      beginRestore: async () => transaction(UPDATED)
    }, coordinator);

    const failure = await router.dispatch(
      WORKSPACE,
      command("skill.pack.update", { id: "ai-berkshire-investment-suite" }),
      "update-ai-berkshire-restored-reload-failure"
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "RUNTIME_POISONED",
      recoverable: false,
      details: { recoveryStage: "reload-restored-resources", resourceStateConsistent: false }
    });
    expect(failure).toHaveProperty("cause", expect.any(AggregateError));
    expect((failure as Error & { cause: AggregateError }).cause.errors)
      .toEqual([firstReloadError, restoredReloadError]);
    expect(rollback).toHaveBeenCalledOnce();
    expect(reloadResources).toHaveBeenCalledTimes(2);
  });
});

function createRouter(
  management: Omit<SkillPackManagementPort, "beginInstall"> & Partial<Pick<SkillPackManagementPort, "beginInstall">>,
  coordinator = new ResourceManagementCoordinator({ listTasks: () => [] })
): SkillPackCommandRouter {
  const complete: SkillPackManagementPort = {
    beginInstall: async () => transaction(UPDATED),
    ...management
  };
  return new SkillPackCommandRouter({
    getWorkspaceServices: () => ({}) as PiWorkspaceRuntimeServices,
    createManagement: () => complete,
    coordinator
  });
}

function transaction(result: SkillPackMutationResult) {
  return {
    result,
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined)
  };
}

function task(workspaceId: string, activeRuntime: AgentRuntime) {
  return {
    taskKey: `${workspaceId}:task`,
    workspaceId,
    runtime: activeRuntime,
    initialized: true,
    isIdle: () => true
  };
}

function runtime(): {
  runtime: AgentRuntime;
  reloadResources: ReturnType<typeof vi.fn<AgentRuntime["reloadResources"]>>;
} {
  const reloadResources = vi.fn<AgentRuntime["reloadResources"]>(async () => ({
    sessionId: "session-skills",
    controls: { thinkingLevel: "off" },
    modelCatalog: { models: [], providers: [], availableThinkingLevels: [] },
    resources: []
  }));
  return {
    runtime: { reloadResources } as unknown as AgentRuntime,
    reloadResources
  };
}

function command<T extends SkillPackCommandType>(
  type: T,
  payload: AgentCommand<T>["payload"]
): AgentCommand<T> {
  return { type, payload } as AgentCommand<T>;
}
