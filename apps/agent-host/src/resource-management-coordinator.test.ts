import { describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "@pi67/pi-runtime";
import { ResourceManagementCoordinator } from "./resource-management-coordinator.js";

describe("ResourceManagementCoordinator shutdown", () => {
  it("fences new commands and waits for the full mutation reload pipeline", async () => {
    let finishReload!: () => void;
    const reloadResources = vi.fn(() => new Promise<void>((resolve) => {
      finishReload = resolve;
    }));
    const coordinator = new ResourceManagementCoordinator({
      listTasks: () => [{
        taskKey: "task-1",
        workspaceId: "workspace-1",
        initialized: true,
        runtime: { reloadResources } as unknown as AgentRuntime,
        isIdle: () => true
      }]
    });

    const mutation = coordinator.runMutation("workspace-1", "project", async () => "done");
    await vi.waitFor(() => expect(reloadResources).toHaveBeenCalledOnce());
    let shutdownSettled = false;
    const shutdown = coordinator.shutdown(500).finally(() => { shutdownSettled = true; });

    expect(() => coordinator.runQuery("workspace-1", async () => undefined))
      .toThrowError(expect.objectContaining({ code: "CONNECTION_CLOSED" }));
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    finishReload();
    await expect(mutation).resolves.toBe("done");
    await expect(shutdown).resolves.toBeUndefined();
  });

  it("fails closed when an active command outlives the shutdown deadline", async () => {
    const coordinator = new ResourceManagementCoordinator({ listTasks: () => [] });
    const query = coordinator.runQuery("workspace-1", () => new Promise<void>(() => undefined));

    await expect(coordinator.shutdown(20)).rejects.toMatchObject({
      code: "RUNTIME_POISONED",
      details: { resourceCommandShutdown: false }
    });
    void query.catch(() => undefined);
  });
});
