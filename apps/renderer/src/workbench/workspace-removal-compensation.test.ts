import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { useAppStore } from "../app/app-store.js";
import { rendererWorkbenchStore } from "./workbench-store.js";
import { registerRendererWorkspaceWithHost, resetWorkspaceHostRegistrationState } from "./workspace-host-registration-controller.js";
import { removeRendererWorkspace } from "./workspace-registration-controller.js";
vi.mock("../connection/connection-recovery.js", () => ({ ensureAgentConnection: vi.fn() }));
beforeEach(() => { vi.restoreAllMocks(); resetWorkspaceHostRegistrationState(); rendererWorkbenchStore.getState().reset(); useAppStore.setState(useAppStore.getInitialState(), true); });
afterEach(() => vi.unstubAllGlobals());
it.each([true, false])("reconciles removal with the real registration cache (retained=%s)", async (retained) => {
  const workspace = { id: "workspace-compensation", displayName: "fixture", identity: { canonicalPath: "/fixture", assurance: "path-only" as const }, trust: "unknown" as const, trustProvenance: "indirect" as const, availability: "available" as const };
  rendererWorkbenchStore.getState().registerWorkspace(workspace);
  vi.mocked(ensureAgentConnection).mockResolvedValue({ appInstanceId: "app", hostInstanceId: "host", hostEpoch: 1, sdkVersion: "fixture", eventSequence: 0 });
  const calls: string[] = [];
  vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
    calls.push(type);
    return {} as never;
  });
  const failure = new Error("Main removal failed");
  vi.stubGlobal("window", { pi67: { system: {
    removeWorkspace: vi.fn().mockRejectedValue(failure),
    loadWorkbenchState: vi.fn().mockResolvedValue({ workspaces: retained ? [workspace] : [] })
  } } });
  await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
  await expect(removeRendererWorkspace(workspace.id)).rejects.toBe(failure);
  expect(calls).toEqual(retained
    ? ["workspace.register", "workspace.unregister", "workspace.register"]
    : ["workspace.register", "workspace.unregister"]);
  expect(rendererWorkbenchStore.getState().workspaces[workspace.id] !== undefined).toBe(retained);
});
