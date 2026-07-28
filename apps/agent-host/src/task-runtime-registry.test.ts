import { describe, expect, it, vi } from "vitest";
import type {
  AgentRuntime,
  PiSdkRuntimeOptions,
  PiWorkspaceRuntimeServices
} from "@pi67/pi-runtime";
import { createRuntimeCredentialOverrideStore } from "@pi67/pi-runtime";
import { TaskRuntimeRegistry } from "./task-runtime-registry.js";

describe("TaskRuntimeRegistry", () => {
  it("loads one independent Runtime per Task with shared Host credentials and Workspace services", async () => {
    const loadedOptions: PiSdkRuntimeOptions[] = [];
    const runtimes = [runtime(), runtime()];
    const loader = vi.fn(async (options?: PiSdkRuntimeOptions) => {
      loadedOptions.push(options ?? {});
      return runtimes[loadedOptions.length - 1]!;
    });
    const credentials = createRuntimeCredentialOverrideStore();
    const workspaceServices = {} as PiWorkspaceRuntimeServices;
    const registry = new TaskRuntimeRegistry(loader, credentials);

    const first = await registry.load(context("task-a"), workspaceServices);
    const second = await registry.load(context("task-b"), workspaceServices);
    expect(first).not.toBe(second);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loadedOptions).toEqual([
      { runtimeCredentialOverrides: credentials, workspaceServices },
      { runtimeCredentialOverrides: credentials, workspaceServices }
    ]);
    await registry.disposeAll();
    expect(runtimes[0]!.disposeSpy).toHaveBeenCalledOnce();
    expect(runtimes[1]!.disposeSpy).toHaveBeenCalledOnce();
  });

  it("rejects stale Task generations and a Runtime reused across Tasks", async () => {
    const shared = runtime();
    const registry = new TaskRuntimeRegistry(
      async () => shared,
      createRuntimeCredentialOverrideStore()
    );
    await registry.load(context("task-a"));
    expect(() => registry.admit({ ...context("task-a"), taskGeneration: 2 }))
      .toThrow(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
    await expect(registry.load(context("task-b"))).rejects.toMatchObject({ code: "INTERNAL" });
    await registry.disposeAll();
  });

  it("admits a newer generation after the previous Task Runtime is closed", async () => {
    const runtimes = [runtime(), runtime()];
    const registry = new TaskRuntimeRegistry(
      async () => runtimes.shift()!,
      createRuntimeCredentialOverrideStore()
    );
    await registry.load(context("task-a"));
    await registry.disposeTask(context("task-a"));

    const reopened = { ...context("task-a"), taskGeneration: 2 };
    await expect(registry.load(reopened)).resolves.toBeDefined();
    expect(registry.get(reopened)).toMatchObject({
      context: reopened,
      closed: false
    });
    await registry.disposeAll();
  });

  it("retains a failed Runtime disposal fence and retries it during Host shutdown", async () => {
    const active = runtime();
    active.disposeSpy.mockRejectedValueOnce(new Error("dispose failed"));
    const registry = new TaskRuntimeRegistry(
      async () => active,
      createRuntimeCredentialOverrideStore()
    );
    await registry.load(context("task-a"));

    await expect(registry.disposeTask(context("task-a"))).rejects.toThrow("dispose failed");
    expect(() => registry.admit({ ...context("task-a"), taskGeneration: 2 }))
      .toThrow(expect.objectContaining({ code: "INVALID_PAYLOAD" }));

    await registry.disposeAll();
    expect(active.disposeSpy).toHaveBeenCalledTimes(2);
    expect(registry.values()).toEqual([]);
  });
});

function context(taskId: string) {
  return {
    scope: "task" as const,
    workspaceId: "workspace-1",
    taskId,
    taskGeneration: 1
  };
}

function runtime() {
  const disposeSpy = vi.fn(async () => undefined);
  return { dispose: disposeSpy, disposeSpy } as unknown as AgentRuntime & {
    disposeSpy: typeof disposeSpy;
  };
}
