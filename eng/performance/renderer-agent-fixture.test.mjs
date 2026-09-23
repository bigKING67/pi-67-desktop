import { afterEach, describe, expect, it, vi } from "vitest";
import { attachMockAgent, installPerformanceSystemBridge } from "./renderer-agent-fixture.mjs";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

describe("Renderer performance system bridge", () => {
  it("hands off the port only on demand and exposes the synthetic Session through the catalog", async () => {
    const responses = [];
    const hostPort = { start() {}, postMessage: (message) => responses.push(message) };
    const rendererPort = {};
    vi.stubGlobal("MessageChannel", class {
      port1 = rendererPort;
      port2 = hostPort;
    });
    vi.stubGlobal("__pi67Performance", undefined);
    globalThis.window = { location: { origin: "http://127.0.0.1" }, postMessage: vi.fn() };
    const page = {
      addInitScript: async (install) => install(),
      exposeFunction: async (name, callback) => vi.stubGlobal(name, callback),
      evaluate: async (callback, input) => callback(input)
    };
    await installPerformanceSystemBridge(page);
    await expect(window.pi67.system.connectAgentHost()).rejects.toThrow("not installed");
    await attachMockAgent(page, 1_000);
    expect(window.postMessage).not.toHaveBeenCalled();
    await window.pi67.system.connectAgentHost();
    expect(window.postMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: "agent-port" }), window.location.origin, [rendererPort]
    );
    await expect(window.pi67.system.connectAgentHost()).rejects.toThrow("port replacement");
    for (const type of ["session.catalog.query", "enterprise.identity.get"]) {
      hostPort.onmessage({ data: {
        kind: "request", requestId: type, type,
        context: type === "session.catalog.query"
          ? { scope: "workspace", workspaceId: "workspace-performance" } : { scope: "app" },
        payload: {}
      } });
    }
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    expect(responses.find((response) => response.type === "session.catalog.query")).toMatchObject({
      ok: true, result: { total: 1, itemCount: 1, items: [{
        id: "performance-session", fileIdentity: "session-file-performance-session", messageCount: 1_000
      }] }
    });
    expect(responses.find((response) => response.type === "enterprise.identity.get")).toMatchObject({
      ok: true, result: { state: "signed-out" }
    });
    hostPort.onmessage({ data: {
      kind: "request", requestId: "initialize", type: "runtime.initialize",
      context: { scope: "task", workspaceId: "workspace-performance", taskId: "task-performance", taskGeneration: 1 },
      payload: {}
    } });
    await vi.waitFor(() => expect(responses.some((response) => response.requestId === "initialize")).toBe(true));
    await globalThis.__pi67Performance.beginStreaming();
    const started = responses.find((response) => response.type === "operation.started");
    await globalThis.__pi67Performance.showMarkdown("Final text", "settled-message");
    expect(responses.at(-1)).toMatchObject({
      type: "conversation.changed",
      context: { operationId: started.payload.operation.operationId },
      payload: { reason: "settled" }
    });
    await globalThis.__pi67Performance.showMarkdown("Static text", "static-message");
    expect(responses.at(-1).context.operationId).toBeUndefined();
    await globalThis.__pi67Performance.finishStreaming();
    expect(responses.at(-1)).toMatchObject({ type: "operation.completed", context: { operationId: started.payload.operation.operationId } });
    await globalThis.__pi67Performance.beginStreaming();
    const nextStarted = responses.findLast((response) => response.type === "operation.started");
    expect(nextStarted.payload.operation.operationId).not.toBe(started.payload.operation.operationId);
    await globalThis.__pi67Performance.finishStreaming(true);
    expect(responses.at(-1)).toMatchObject({ type: "operation.cancelled", context: { operationId: nextStarted.payload.operation.operationId } });
  });

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
