import type { ProviderSummary } from "@pi67/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { configureRuntimeProviderKey } from "../session/session-control-controller.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import {
  configureWorkspaceProviderKey,
  loadWorkspaceProviderCatalog
} from "./workspace-provider-controller.js";

vi.mock("../session/session-control-controller.js", () => ({
  configureRuntimeProviderKey: vi.fn()
}));

vi.mock("../workbench/workspace-host-registration-controller.js", () => ({
  registerRendererWorkspaceWithHost: vi.fn().mockResolvedValue(true)
}));

const configureRuntime = vi.mocked(configureRuntimeProviderKey);
const registerWorkspace = vi.mocked(registerRendererWorkspaceWithHost);
const PROVIDERS: ProviderSummary[] = [{
  id: "openai",
  label: "OpenAI",
  configured: true,
  credentialSource: "runtime",
  modelCount: 2
}];

describe("workspace Provider controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    configureRuntime.mockReset();
    registerWorkspace.mockReset().mockResolvedValue(true);
    rendererWorkbenchStore.getState().reset();
    rendererWorkbenchStore.getState().registerWorkspace(workspace());
    useAppStore.setState(useAppStore.getInitialState(), true);
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
  });

  it("uses the active Session projection as the Provider catalog authority", async () => {
    installActiveTask();
    const request = vi.spyOn(agentConnectionController, "request");

    await expect(loadWorkspaceProviderCatalog("workspace-a")).resolves.toEqual(PROVIDERS);

    expect(registerWorkspace).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("registers an inactive Workspace and requests its bounded catalog", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(PROVIDERS as never);

    await expect(loadWorkspaceProviderCatalog("workspace-a")).resolves.toEqual(PROVIDERS);

    expect(registerWorkspace).toHaveBeenCalledWith(workspace(), { queryCatalog: false });
    expect(request).toHaveBeenCalledWith(
      "provider.list",
      {},
      [],
      { context: { scope: "workspace", workspaceId: "workspace-a" } }
    );
  });

  it("fails explicitly when Settings targets a removed Workspace", async () => {
    await expect(loadWorkspaceProviderCatalog("missing")).rejects.toThrow(
      "当前设置没有可用的工作区。"
    );
  });

  it("configures the active Runtime with its complete Task authority", async () => {
    installActiveTask();
    configureRuntime.mockResolvedValue(true);

    await expect(configureWorkspaceProviderKey(
      "workspace-a",
      "openai",
      "runtime-secret"
    )).resolves.toEqual(PROVIDERS);

    expect(configureRuntime).toHaveBeenCalledWith(
      "openai",
      "runtime-secret",
      {
        scope: "task",
        workspaceId: "workspace-a",
        taskId: "task-a",
        taskGeneration: 3,
        sessionId: "session-a",
        sessionGeneration: 4
      }
    );
  });

  it("does not fabricate a catalog when the active Runtime rejects the key", async () => {
    installActiveTask();
    configureRuntime.mockResolvedValue(false);

    await expect(configureWorkspaceProviderKey(
      "workspace-a",
      "openai",
      "runtime-secret"
    )).resolves.toBeUndefined();
  });

  it("configures an inactive Workspace without promoting the secret into state", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(PROVIDERS as never);

    await expect(configureWorkspaceProviderKey(
      "workspace-a",
      "openai",
      "runtime-secret"
    )).resolves.toEqual(PROVIDERS);

    expect(request).toHaveBeenCalledWith(
      "provider.setRuntimeKey",
      { provider: "openai", apiKey: "runtime-secret" },
      [],
      { context: { scope: "workspace", workspaceId: "workspace-a" } }
    );
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "info",
      title: "openai API 密钥已在本次运行中启用"
    });
    expect(JSON.stringify(rendererWorkbenchStore.getState())).not.toContain("runtime-secret");
    expect(JSON.stringify(useSessionProjectionStore.getState())).not.toContain("runtime-secret");
  });

  it("keeps Workspace configuration failures observable without throwing from the dialog action", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue("transport failure");

    await expect(configureWorkspaceProviderKey(
      "workspace-a",
      "openai",
      "runtime-secret"
    )).resolves.toBeUndefined();

    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      message: "未知错误"
    });
  });
});

function installActiveTask(): void {
  rendererWorkbenchStore.getState().openTask({
    id: "task-a",
    conversation: {
      kind: "session",
      workspaceId: "workspace-a",
      sessionPath: "/sessions/a.jsonl"
    },
    workspaceId: "workspace-a",
    sessionId: "session-a",
    taskGeneration: 3,
    sessionGeneration: 4,
    lifecycle: "idle",
    runtime: { phase: "ready", detail: "Pi 会话已就绪", recoverable: true },
    title: "A",
    sessionPath: "/sessions/a.jsonl",
    hasDraft: false,
    attachmentCount: 0
  });
  useAppStore.setState({ connected: true, hostEpoch: 9, workspace: "/work/a" });
  useSessionProjectionStore.setState({
    authority: {
      phase: "active",
      hostEpoch: 9,
      sessionId: "session-a",
      sessionGeneration: 4,
      projectionRevision: 1
    },
    modelCatalog: {
      models: [],
      providers: PROVIDERS,
      availableThinkingLevels: ["off"]
    }
  });
}

function workspace() {
  return {
    id: "workspace-a",
    displayName: "A",
    identity: { canonicalPath: "/work/a", assurance: "filesystem" as const },
    trust: "trusted" as const,
    trustProvenance: "native-picker" as const,
    availability: "available" as const
  };
}
