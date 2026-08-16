import { ProtocolRequestError, type PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { resetWorkspaceHostRegistrationState } from "../workbench/workspace-host-registration-controller.js";
import {
  loadProviderConfiguration,
  loadProjectProviderConfiguration,
  resetProviderConfigurationLoadState,
  saveProviderConfiguration,
  setDefaultModelConfiguration,
  setGlobalVisionAssistantConfiguration,
  storePersistentCredential
} from "./provider-configuration-controller.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";

describe("provider configuration controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rendererWorkbenchStore.getState().reset();
    resetWorkspaceHostRegistrationState();
    resetProviderConfigurationLoadState();
    useProviderConfigurationStore.getState().reset();
    useNotificationStore.getState().clear();
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-a",
      displayName: "Workspace A",
      identity: { canonicalPath: "/work/a", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({
      appInstanceId: "app",
      hostInstanceId: "host",
      hostEpoch: 2,
      sdkVersion: "fixture",
      eventSequence: 0
    });
  });

  it("loads through App authority without registering or starting a Workspace", async () => {
    const configuration = snapshot("1");
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "provider.configuration.get") return configuration as never;
      throw new Error(`Unexpected command: ${type}`);
    });

    await expect(loadProviderConfiguration("workspace-a")).resolves.toBe(true);
    expect(request).toHaveBeenNthCalledWith(1,
      "provider.configuration.get",
      {},
      [],
      {
        context: { scope: "app" },
        ackTimeoutMs: 12_000
      }
    );
    expect(useProviderConfigurationStore.getState()).toMatchObject({
      workspaceId: "app",
      snapshot: configuration,
      baselineRevision: configuration.revision,
      dirty: false
    });
  });

  it("shares one Provider load and one failure notification across concurrent mounts", async () => {
    const pending = deferred<PiProviderConfigurationSnapshot>();
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation((type) => {
      if (type === "provider.configuration.get") return pending.promise as never;
      throw new Error(`Unexpected command: ${type}`);
    });

    const first = loadProviderConfiguration("workspace-a");
    const second = loadProviderConfiguration("workspace-a");
    expect(first).toBe(second);
    await vi.waitFor(() => expect(
      request.mock.calls.filter(([type]) => type === "provider.configuration.get")
    ).toHaveLength(1));

    pending.reject(new Error("provider request timed out"));
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);

    expect(request.mock.calls.filter(([type]) => type === "workspace.register")).toHaveLength(0);
    expect(useProviderConfigurationStore.getState()).toMatchObject({
      workspaceId: "app",
      phase: "failed",
      error: "provider request timed out"
    });
    expect(useNotificationStore.getState().items).toHaveLength(0);
  });

  it("sends a persistent credential only through its write-only mutation", async () => {
    const initial = snapshot("1");
    const saved = snapshot("2", [{ provider: "custom", type: "api_key" }]);
    useProviderConfigurationStore.getState().beginLoad("app");
    useProviderConfigurationStore.getState().install("app", initial);
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(saved as never);
    const credential = "controller-write-only-credential";

    await expect(storePersistentCredential("workspace-a", "custom", credential)).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      "provider.credential.store",
      { expectedRevision: initial.revision, provider: "custom", apiKey: credential },
      [],
      { context: { scope: "app" } }
    );
    expect(JSON.stringify(useProviderConfigurationStore.getState())).not.toContain(credential);
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      title: "凭据已保存到 Pi auth.json"
    });
  });

  it("preserves the draft when a stale revision blocks saving", async () => {
    const initial = snapshot("1");
    useProviderConfigurationStore.getState().beginLoad("app");
    useProviderConfigurationStore.getState().install("app", initial);
    useProviderConfigurationStore.getState().updateDraft((draft) => ({
      ...draft,
      name: "Unsaved Provider Draft"
    }));
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new ProtocolRequestError({
      code: "CONFIGURATION_CHANGED_EXTERNALLY",
      message: "Pi configuration changed outside Desktop.",
      recoverable: true
    }));

    await expect(saveProviderConfiguration("workspace-a")).resolves.toBe(false);
    expect(useProviderConfigurationStore.getState()).toMatchObject({
      draft: { name: "Unsaved Provider Draft" },
      baselineRevision: initial.revision,
      dirty: true,
      phase: "failed"
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "Pi 配置已在外部修改"
    });
  });

  it("writes global and project defaults with the current configuration revision", async () => {
    const initial = snapshot("1");
    const global = snapshot("2");
    global.defaults.global = { provider: "custom", model: "model-a" };
    global.defaults.effective = global.defaults.global;
    useProviderConfigurationStore.getState().beginLoad("app");
    useProviderConfigurationStore.getState().install("app", initial);
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(global as never);

    await expect(setDefaultModelConfiguration(
      "global",
      { provider: "custom", model: "model-a" },
      "workspace-a"
    )).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      "model.default.set",
      {
        expectedRevision: initial.revision,
        scope: "global",
        provider: "custom",
        model: "model-a"
      },
      [],
      { context: { scope: "app" } }
    );
  });

  it("rejects global mutations while a project snapshot is current", async () => {
    const project = snapshot("2");
    useProviderConfigurationStore.getState().beginLoad("project:workspace-a");
    useProviderConfigurationStore.getState().install("project:workspace-a", project);
    const request = vi.spyOn(agentConnectionController, "request");

    await expect(setDefaultModelConfiguration(
      "global",
      { provider: "custom", model: "model-a" },
      "workspace-a"
    )).resolves.toBe(false);
    await expect(setGlobalVisionAssistantConfiguration({
      provider: "custom",
      model: "model-a"
    })).resolves.toBe(false);

    expect(request).not.toHaveBeenCalled();
  });

  it("registers a trusted Workspace before loading and mutating project overrides", async () => {
    const initial = snapshot("1");
    const project = snapshot("2");
    project.defaults.project = { provider: "custom", model: "model-a" };
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.register") return { registered: true } as never;
      if (type === "provider.projectConfiguration.get") return initial as never;
      if (type === "model.projectDefault.set") return project as never;
      throw new Error(`Unexpected command: ${type}`);
    });

    await expect(loadProjectProviderConfiguration("workspace-a")).resolves.toBe(true);
    await expect(setDefaultModelConfiguration(
      "project",
      { provider: "custom", model: "model-a" },
      "workspace-a"
    )).resolves.toBe(true);
    expect(request).toHaveBeenLastCalledWith(
      "model.projectDefault.set",
      {
        expectedRevision: initial.revision,
        provider: "custom",
        model: "model-a"
      },
      [],
      { context: { scope: "workspace", workspaceId: "workspace-a" } }
    );
  });

  it("keeps the project snapshot when a late global load completes", async () => {
    const global = deferred<PiProviderConfigurationSnapshot>();
    const project = deferred<PiProviderConfigurationSnapshot>();
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation((type) => {
      if (type === "provider.configuration.get") return global.promise as never;
      if (type === "workspace.register") return Promise.resolve({ registered: true }) as never;
      if (type === "provider.projectConfiguration.get") return project.promise as never;
      throw new Error(`Unexpected command: ${type}`);
    });

    const globalLoad = loadProviderConfiguration();
    await vi.waitFor(() => expect(
      request.mock.calls.filter(([type]) => type === "provider.configuration.get")
    ).toHaveLength(1));
    const projectLoad = loadProjectProviderConfiguration("workspace-a");
    await vi.waitFor(() => expect(
      request.mock.calls.filter(([type]) => type === "provider.projectConfiguration.get")
    ).toHaveLength(1));

    const projectSnapshot = snapshot("2");
    project.resolve(projectSnapshot);
    await expect(projectLoad).resolves.toBe(true);
    const globalSnapshot = snapshot("1");
    global.resolve(globalSnapshot);
    await expect(globalLoad).resolves.toBe(true);

    expect(useProviderConfigurationStore.getState()).toMatchObject({
      workspaceId: "project:workspace-a",
      snapshot: projectSnapshot,
      baselineRevision: projectSnapshot.revision
    });
  });

  it("keeps the global snapshot when a late project load completes", async () => {
    const global = deferred<PiProviderConfigurationSnapshot>();
    const project = deferred<PiProviderConfigurationSnapshot>();
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation((type) => {
      if (type === "provider.configuration.get") return global.promise as never;
      if (type === "workspace.register") return Promise.resolve({ registered: true }) as never;
      if (type === "provider.projectConfiguration.get") return project.promise as never;
      throw new Error(`Unexpected command: ${type}`);
    });

    const projectLoad = loadProjectProviderConfiguration("workspace-a");
    await vi.waitFor(() => expect(
      request.mock.calls.filter(([type]) => type === "provider.projectConfiguration.get")
    ).toHaveLength(1));
    const globalLoad = loadProviderConfiguration();
    await vi.waitFor(() => expect(
      request.mock.calls.filter(([type]) => type === "provider.configuration.get")
    ).toHaveLength(1));

    const globalSnapshot = snapshot("1");
    global.resolve(globalSnapshot);
    await expect(globalLoad).resolves.toBe(true);
    const projectSnapshot = snapshot("2");
    project.resolve(projectSnapshot);
    await expect(projectLoad).resolves.toBe(true);

    expect(useProviderConfigurationStore.getState()).toMatchObject({
      workspaceId: "app",
      snapshot: globalSnapshot,
      baselineRevision: globalSnapshot.revision
    });
  });

  it("restores the requested scope when reusing an in-flight load", async () => {
    const global = deferred<PiProviderConfigurationSnapshot>();
    const project = deferred<PiProviderConfigurationSnapshot>();
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation((type) => {
      if (type === "provider.configuration.get") return global.promise as never;
      if (type === "workspace.register") return Promise.resolve({ registered: true }) as never;
      if (type === "provider.projectConfiguration.get") return project.promise as never;
      throw new Error(`Unexpected command: ${type}`);
    });

    const firstGlobalLoad = loadProviderConfiguration();
    await vi.waitFor(() => expect(
      request.mock.calls.filter(([type]) => type === "provider.configuration.get")
    ).toHaveLength(1));
    const projectLoad = loadProjectProviderConfiguration("workspace-a");
    await vi.waitFor(() => expect(
      request.mock.calls.filter(([type]) => type === "provider.projectConfiguration.get")
    ).toHaveLength(1));

    const secondGlobalLoad = loadProviderConfiguration();
    expect(secondGlobalLoad).toBe(firstGlobalLoad);
    expect(useProviderConfigurationStore.getState().workspaceId).toBe("app");

    const globalSnapshot = snapshot("1");
    global.resolve(globalSnapshot);
    await expect(secondGlobalLoad).resolves.toBe(true);
    const projectSnapshot = snapshot("2");
    project.resolve(projectSnapshot);
    await expect(projectLoad).resolves.toBe(true);

    expect(useProviderConfigurationStore.getState()).toMatchObject({
      workspaceId: "app",
      snapshot: globalSnapshot,
      baselineRevision: globalSnapshot.revision
    });
  });
});

function snapshot(
  revisionCharacter: string,
  credentials: PiProviderConfigurationSnapshot["credentials"] = []
): PiProviderConfigurationSnapshot {
  return {
    revision: revisionCharacter.repeat(64),
    syncState: "current",
    updatedAt: 1,
    providers: [{
      id: "custom",
      name: "Custom",
      origin: "models.json",
      configured: credentials.length > 0,
      modelsJsonApiKeyConfigured: false,
      headerNames: [],
      models: [{
        id: "model-a",
        input: ["text"],
        reasoning: false,
        headerNames: [],
        advancedJson: "{}"
      }],
      modelCount: 1,
      advancedJson: "{}"
    }],
    credentials,
    defaults: { projectTrusted: true },
    vision: { disabledByProject: false, projectTrusted: true },
    files: [
      file("models"),
      file("auth"),
      file("global-settings"),
      file("project-settings")
    ],
    diagnostics: []
  };
}

function file(kind: PiProviderConfigurationSnapshot["files"][number]["kind"]) {
  return { kind, path: `/fixture/${kind}.json`, exists: true, valid: true };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
