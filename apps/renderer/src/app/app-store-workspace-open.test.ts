import type { RuntimeCapabilities, SessionSnapshot, WorkspaceChangesProjection,
  WorkspaceDescriptor } from "@pi67/domain";
import { eventEnvelope, type ProjectionResyncResult } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApprovalStore } from "../approval/approval-store.js";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import {
  openRendererWorkspace,
  openRendererWorkspaceDescriptor
} from "../workspace/workspace-open-controller.js";
import { routeWorkbenchAgentEvent } from "../workbench/workbench-event-router.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { resetWorkspaceHostRegistrationState } from "../workbench/workspace-host-registration-controller.js";
import { useAppStore } from "./app-store.js";

describe("App Store workspace open authority", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ connected: true, hostEpoch: 9 });
    installSessionProjectionFixture(
      useAppStore.getState(),
      snapshot("session-1"),
      3
    );
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue(connectionIdentity(9));
    vi.stubGlobal("window", {
      pi67: {
        system: {
          selectWorkspace: vi.fn().mockResolvedValue("/workspace-next")
        }
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetStores();
  });

  it("keeps runtime.ready state when workspace.open rejects after the authoritative event", async () => {
    vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.open") {
        const readySnapshot = snapshot("session-2");
        const payload = { capabilities: runtimeCapabilities(), snapshot: readySnapshot, taskToolMode: "auto" as const };
        useAppStore.getState().receiveAgentEvent(
          { type: "runtime.ready", payload },
          eventEnvelope("runtime.ready", payload, taskEventFixture({
            hostEpoch: 9,
            sequence: 2,
            sessionId: "session-2",
            sessionGeneration: 4
          }))
        );
        throw new Error("late workspace rejection");
      }
      if (type === "workspace.changes") return emptyChanges("session-2") as never;
      if (type === "workspace.register") return { registered: true } as never;
      if (type === "session.catalog.query") return emptyCatalogPage() as never;
      throw new Error(`Unexpected request: ${type}`);
    });

    await openRendererWorkspace();

    expect(useAppStore.getState()).toMatchObject({
      workspace: "/workspace-next",
      sessionTransitionPending: false,
      runtime: { phase: "ready", detail: "Pi SDK 已就绪" }
    });
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("fails closed when workspace.open returns without authoritative runtime.ready", async () => {
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(
      projectionAcknowledgement("session-2", 4) as never
    );

    await openRendererWorkspace();

    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      runtime: {
        phase: "failed",
        detail: "无法打开工作区：Pi 运行服务未发送 authoritative runtime.ready 事件。"
      }
    });
    expect(useSessionProjectionStore.getState().authority.phase).toBe("inactive");
    expectFailedWorkbenchTask("无法打开工作区：Pi 运行服务未发送 authoritative runtime.ready 事件。");
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法打开工作区"
    });
  });

  it("opens a catalog Session in an independent Task Runtime", async () => {
    const descriptor = workspaceDescriptor("workspace-catalog", "/workspace-catalog");
    const existingTaskId = "task-existing";
    rendererWorkbenchStore.getState().registerWorkspace(descriptor);
    rendererWorkbenchStore.getState().openTask({
      id: existingTaskId,
      conversation: { kind: "provisional", workspaceId: descriptor.id, draftId: existingTaskId },
      workspaceId: descriptor.id,
      sessionId: "session-existing",
      taskGeneration: 1,
      sessionGeneration: 2,
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "Pi 会话已就绪", recoverable: true },
      title: "Existing task",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0
    });
    const sessionPath = "/sessions/catalog-target.jsonl";
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (
      type,
      payload,
      _transfer,
      options
    ) => {
      if (type === "workspace.register") return { registered: true } as never;
      if (type === "runtime.initialize") {
        expect(payload).toEqual({
          cwd: descriptor.identity.canonicalPath,
          sessionPath,
          trust: "trusted",
          approvalMode: "balanced"
        });
        const context = options?.context;
        if (!context || context.scope !== "task") throw new Error("Expected Task context.");
        expect(context.taskId).not.toBe(existingTaskId);
        const readySnapshot = {
          ...snapshot("session-catalog-target"),
          cwd: descriptor.identity.canonicalPath,
          sessionPath
        };
        const readyPayload = { capabilities: runtimeCapabilities(), snapshot: readySnapshot, taskToolMode: "auto" as const };
        const envelope = eventEnvelope("runtime.ready", readyPayload, taskEventFixture({
          hostEpoch: 9,
          sequence: 2,
          workspaceId: context.workspaceId,
          taskId: context.taskId,
          taskGeneration: context.taskGeneration,
          sessionId: readySnapshot.sessionId,
          sessionGeneration: 1
        }));
        const event = { type: "runtime.ready", payload: readyPayload } as const;
        routeWorkbenchAgentEvent(event, envelope);
        useAppStore.getState().receiveAgentEvent(event, envelope);
        return projectionAcknowledgement(readySnapshot.sessionId, 1) as never;
      }
      if (type === "session.catalog.query") return emptyCatalogPage() as never;
      throw new Error(`Unexpected request: ${type}`);
    });

    await openRendererWorkspaceDescriptor(descriptor, sessionPath);

    expect(request).toHaveBeenCalledWith(
      "runtime.initialize",
      expect.objectContaining({ sessionPath }),
      [],
      expect.objectContaining({ context: expect.objectContaining({ scope: "task" }) })
    );
    expect(request).not.toHaveBeenCalledWith("workspace.open", expect.anything());
    expect(request).not.toHaveBeenCalledWith("session.open", expect.anything());
    const workbench = rendererWorkbenchStore.getState();
    expect(workbench.runtimeTaskOrder).toHaveLength(2);
    expect(workbench.tasks[existingTaskId]).toMatchObject({
      conversation: { kind: "provisional" },
      sessionId: "session-existing"
    });
    expect(Object.values(workbench.tasks)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        conversation: { kind: "session", workspaceId: descriptor.id, sessionPath },
        sessionId: "session-catalog-target",
        sessionPath,
        lifecycle: "idle"
      })
    ]));
    expect(useAppStore.getState()).toMatchObject({
      workspace: descriptor.identity.canonicalPath,
      sessionTransitionPending: false,
      runtime: { phase: "ready", detail: "Pi SDK 已就绪" }
    });
  });

  it("resynchronizes after Session initialization when runtime.ready was blocked", async () => {
    const descriptor = workspaceDescriptor("workspace-resync", "/workspace-resync");
    const sessionPath = "/sessions/resync-target.jsonl";
    const readySnapshot = {
      ...snapshot("session-resync-target"),
      cwd: descriptor.identity.canonicalPath,
      sessionPath
    };
    rendererWorkbenchStore.getState().registerWorkspace(descriptor);
    vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.register") return { registered: true } as never;
      if (type === "runtime.initialize") {
        return projectionAcknowledgement(readySnapshot.sessionId, 1) as never;
      }
      if (type === "session.catalog.query") return emptyCatalogPage() as never;
      throw new Error(`Unexpected request: ${type}`);
    });
    const resync = vi.spyOn(agentConnectionController, "resyncProjection")
      .mockImplementation(async (install) => install(projectionResyncResult(readySnapshot, 1)));

    await expect(openRendererWorkspaceDescriptor(descriptor, sessionPath)).resolves.toBe(true);

    expect(resync).toHaveBeenCalledOnce();
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: readySnapshot.sessionId,
      sessionGeneration: 1
    });
    expect(useAppStore.getState()).toMatchObject({
      workspace: descriptor.identity.canonicalPath,
      sessionTransitionPending: false,
      runtime: { phase: "ready", detail: "Pi 会话已恢复" }
    });
  });

  it("waits for Workspace registration before initializing a saved Session", async () => {
    const descriptor = workspaceDescriptor(
      "workspace-registration-order",
      "/workspace-registration-order"
    );
    const registration = deferred<void>();
    const requestOrder: string[] = [];
    rendererWorkbenchStore.getState().registerWorkspace(descriptor);
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.register") {
        requestOrder.push("workspace.register:start");
        await registration.promise;
        requestOrder.push("workspace.register:end");
        return { registered: true } as never;
      }
      if (type === "runtime.initialize") {
        requestOrder.push("runtime.initialize");
        throw new Error("stop after ordering assertion");
      }
      throw new Error(`Unexpected request: ${type}`);
    });

    const opening = openRendererWorkspaceDescriptor(descriptor, "/sessions/registration-order.jsonl");
    await vi.waitFor(() => expect(requestOrder).toEqual(["workspace.register:start"]));
    expect(request).not.toHaveBeenCalledWith(
      "runtime.initialize",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );

    registration.resolve();
    await expect(opening).resolves.toBe(false);
    expect(requestOrder).toEqual([
      "workspace.register:start",
      "workspace.register:end",
      "runtime.initialize"
    ]);
  });

  it("surfaces Workspace registration failure without starting the saved Session", async () => {
    const descriptor = workspaceDescriptor(
      "workspace-registration-failure",
      "/workspace-registration-failure"
    );
    rendererWorkbenchStore.getState().registerWorkspace(descriptor);
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.register") throw new Error("Workspace registration failed");
      throw new Error(`Unexpected request: ${type}`);
    });

    await expect(openRendererWorkspaceDescriptor(
      descriptor,
      "/sessions/registration-failure.jsonl"
    )).resolves.toBe(false);

    expect(request).not.toHaveBeenCalledWith(
      "runtime.initialize",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      runtime: {
        phase: "failed",
        detail: "无法打开会话：Workspace registration failed"
      }
    });
    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([]);
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法打开会话",
      message: "Workspace registration failed"
    });
  });
});

function resetStores(): void {
  resetWorkspaceHostRegistrationState();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useApprovalStore.setState(useApprovalStore.getInitialState(), true);
  useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
  useConversationStore.setState(useConversationStore.getInitialState(), true);
  useExtensionUiStore.setState(useExtensionUiStore.getInitialState(), true);
  useLiveTurnStore.setState(useLiveTurnStore.getInitialState(), true);
  useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  useSessionTreeStore.setState(useSessionTreeStore.getInitialState(), true);
  rendererWorkbenchStore.getState().reset();
}

function expectFailedWorkbenchTask(detail: string): void {
  expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([
    expect.objectContaining({ lifecycle: "lost", runtime: { phase: "failed", detail, recoverable: true } })
  ]);
}

function snapshot(sessionId: string): SessionSnapshot {
  return {
    sessionId,
    sessionPath: `/sessions/${sessionId}.jsonl`,
    cwd: "/workspace",
    streaming: false,
    messages: [],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [],
    providers: [],
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: []
  };
}

function runtimeCapabilities(): RuntimeCapabilities {
  return {
    sdkVersion: "0.81.1",
    supportsFollowUp: true,
    supportsSessionTree: true,
    extensionUi: {
      primitives: [],
      attribution: "none",
      recognizedCompatibilityLevels: [],
      adapterRegistry: {
        available: false,
        manifestSchemaVersions: [],
        supportedSurfaces: [],
        realtimeUiAttribution: false,
        activeAdapterCount: 0
      },
      limitations: {
        workingIndicator: "unsupported",
        editorMutation: "unsupported",
        customComponents: "tui-only",
        autocomplete: "tui-only",
        widgetPlacements: []
      }
    }
  };
}

function projectionAcknowledgement(sessionId: string, sessionGeneration: number) {
  return {
    accepted: true as const,
    hostEpoch: 9,
    sessionId,
    sessionGeneration,
    eventSequence: 2
  };
}

function connectionIdentity(hostEpoch: number) {
  return {
    appInstanceId: "app-1",
    hostInstanceId: `host-${hostEpoch}`,
    hostEpoch,
    sdkVersion: "0.81.1",
    eventSequence: 0
  };
}

function emptyChanges(sessionId: string): WorkspaceChangesProjection {
  return { sessionId, items: [], truncated: false, total: 0 };
}

function emptyCatalogPage() {
  return {
    revision: 1,
    itemCount: 0,
    source: "sqlite" as const,
    state: "ready" as const,
    rebuilding: false,
    incomplete: false,
    skippedCount: 0,
    items: [],
    total: 0,
    hasMore: false
  };
}

function projectionResyncResult(
  value: SessionSnapshot,
  sessionGeneration: number
): ProjectionResyncResult {
  return {
    snapshot: value,
    changes: emptyChanges(value.sessionId),
    extensionCatalog: { items: [], total: 0, truncated: false },
    sessionCatalogStatus: {
      revision: 1,
      itemCount: 0,
      source: "sqlite",
      state: "ready",
      rebuilding: false,
      incomplete: false,
      skippedCount: 0
    },
    eventSequence: 3,
    hostEpoch: 9,
    sessionGeneration,
    taskToolMode: "auto"
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function workspaceDescriptor(id: string, canonicalPath: string): WorkspaceDescriptor {
  return {
    id,
    displayName: id,
    identity: { canonicalPath, assurance: "path-only" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}
