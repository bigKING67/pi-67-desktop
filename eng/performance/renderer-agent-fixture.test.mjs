import { afterEach, describe, expect, it } from "vitest";
import { installPerformanceSystemBridge } from "./renderer-agent-fixture.mjs";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

describe("Renderer performance system bridge", () => {
  it("implements the current App bootstrap and repository contracts", async () => {
    globalThis.window = {};
    const page = {
      addInitScript: async (install) => install()
    };

    await installPerformanceSystemBridge(page);

    const bridge = globalThis.window.pi67.system;
    expect(await bridge.loadWorkbenchState()).toEqual(expect.objectContaining({
      version: 5,
      workspaceEnvironments: [],
      environmentMutations: []
    }));
    const workspace = await bridge.pickAndAddWorkspace();
    expect(await bridge.loadWorkbenchState()).toEqual(expect.objectContaining({
      workspaceEnvironments: [{
        workspaceId: workspace.id,
        kind: "plain",
        ownership: "user"
      }]
    }));
    await expect(bridge.inspectRepositoryEnvironment({ workspaceId: workspace.id })).resolves.toEqual(
      expect.objectContaining({
        workspaceId: workspace.id,
        status: "non-git",
        stale: false,
        worktrees: []
      })
    );
    expect(bridge.onAgentHostStartup(() => undefined)).toBeTypeOf("function");
    expect(bridge.onShutdownCheckpointRequested(() => undefined)).toBeTypeOf("function");
    await expect(bridge.completeShutdownCheckpoint({
      requestId: "performance-shutdown",
      succeeded: true
    })).resolves.toBe(true);
  });
});
