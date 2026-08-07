import type { SessionCatalogPage, SessionSnapshot } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  openRendererWorkspace,
  openRendererWorkspaceDescriptor
} from "../workspace/workspace-open-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { resetWorkspaceHostRegistrationState } from "../workbench/workspace-host-registration-controller.js";
import { useAppStore } from "./app-store.js";
import { applyRendererAgentEvent } from "./renderer-agent-event-controller.js";
import {
  deferred,
  emptyWorkspaceChanges,
  workspaceConnectionIdentity,
  workspaceDescriptorFixture,
  workspaceRuntimeCapabilities
} from "./workspace-open-test-fixtures.js";

describe("Workspace open Catalog ordering", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ connected: true, hostEpoch: 9 });
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue(workspaceConnectionIdentity());
    vi.stubGlobal("window", {
      pi67: { system: { selectWorkspace: vi.fn().mockResolvedValue("/workspace-next") } }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetStores();
  });

  it("queries the Catalog before opening the first persisted Session", async () => {
    const requestOrder: string[] = [];
    const registration = deferred<void>();
    const catalogQuery = deferred<void>();
    const initialSnapshot = snapshot();
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (
      type,
      requestPayload,
      _transfer,
      options
    ) => {
      requestOrder.push(type);
      if (type === "workspace.register") {
        await registration.promise;
        return { registered: true } as never;
      }
      if (type === "session.catalog.query") {
        expect(requestPayload).toEqual({ scope: "workspace", limit: 50, refresh: true });
        expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([]);
        await catalogQuery.promise;
        return catalogPageForSnapshot(initialSnapshot) as never;
      }
      if (type === "runtime.initialize") {
        expect(requestPayload).toEqual({
          cwd: initialSnapshot.cwd,
          sessionPath: initialSnapshot.sessionPath,
          trust: "trusted",
          approvalMode: "balanced"
        });
        const context = options?.context;
        if (!context || context.scope !== "task") throw new Error("Expected Task context.");
        expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([
          expect.objectContaining({
            id: context.taskId,
            conversation: expect.objectContaining({
              kind: "session",
              workspaceId: context.workspaceId,
              sessionFileIdentity: initialSnapshot.sessionFileIdentity,
              sessionPath: initialSnapshot.sessionPath
            }),
            lifecycle: "initializing"
          })
        ]);
        const payload = {
          capabilities: workspaceRuntimeCapabilities(),
          snapshot: initialSnapshot,
          taskToolMode: "auto" as const
        };
        const envelope = eventEnvelope("runtime.ready", payload, taskEventFixture({
          hostEpoch: 9,
          sequence: 2,
          workspaceId: context.workspaceId,
          taskId: context.taskId,
          taskGeneration: context.taskGeneration,
          sessionId: initialSnapshot.sessionId,
          sessionFileIdentity: initialSnapshot.sessionFileIdentity,
          sessionGeneration: 1
        }));
        const event = { type: "runtime.ready", payload } as const;
        applyRendererAgentEvent(event, envelope);
        return projectionAcknowledgement(initialSnapshot.sessionId) as never;
      }
      if (type === "workspace.changes") return emptyWorkspaceChanges(initialSnapshot.sessionId) as never;
      throw new Error(`Unexpected request: ${type}`);
    });

    const opening = openRendererWorkspace();
    await vi.waitFor(() => expect(requestOrder).toEqual(["workspace.register"]));
    expect(useAppStore.getState()).toMatchObject({
      workspace: initialSnapshot.cwd,
      sessionTransitionPending: true,
      runtime: { phase: "starting", detail: "正在加载 Pi SDK" }
    });
    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([]);

    registration.resolve();
    await vi.waitFor(() => expect(requestOrder).toContain("session.catalog.query"));
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: true,
      workspaceOpenPending: true,
      runtime: { phase: "starting", detail: "正在加载 Pi SDK" }
    });
    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([]);

    catalogQuery.resolve();
    await opening;

    expect(useAppStore.getState()).toMatchObject({
      workspace: initialSnapshot.cwd,
      sessionTransitionPending: false,
      workspaceOpenPending: false,
      runtime: { phase: "ready", detail: "Pi SDK 已就绪" }
    });
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: initialSnapshot.sessionId,
      sessionGeneration: 1
    });
    expect(requestOrder.filter((type) => type !== "workspace.changes")).toEqual([
      "workspace.register",
      "session.catalog.query",
      "runtime.initialize"
    ]);
    expect(request.mock.calls.filter(([type]) => type === "session.catalog.query")).toHaveLength(1);
    expect(request.mock.calls.filter(([type]) => type === "workspace.open")).toHaveLength(0);
    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([
      expect.objectContaining({
        conversation: expect.objectContaining({
          kind: "session",
          sessionFileIdentity: initialSnapshot.sessionFileIdentity,
          sessionPath: initialSnapshot.sessionPath
        }),
        sessionId: initialSnapshot.sessionId,
        sessionPath: initialSnapshot.sessionPath,
        lifecycle: "idle"
      })
    ]);
    expect(Object.values(useSessionCatalogStore.getState().byWorkspace)).toEqual([
      expect.objectContaining({
        items: [expect.objectContaining({
          id: initialSnapshot.sessionId,
          path: initialSnapshot.sessionPath
        })]
      })
    ]);
  });

  it("creates the first Session exactly once only after the Catalog is authoritatively empty", async () => {
    const requestOrder: string[] = [];
    const initialSnapshot = snapshot();
    let catalogQueries = 0;
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (
      type,
      _requestPayload,
      _transfer,
      options
    ) => {
      requestOrder.push(type);
      if (type === "workspace.register") return { registered: true } as never;
      if (type === "session.catalog.query") {
        catalogQueries += 1;
        return (catalogQueries === 1
          ? emptyCatalogPage()
          : catalogPageForSnapshot(initialSnapshot)) as never;
      }
      if (type === "workspace.open") {
        const context = options?.context;
        if (!context || context.scope !== "task") throw new Error("Expected Task context.");
        expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([
          expect.objectContaining({
            id: context.taskId,
            conversation: expect.objectContaining({ kind: "provisional" }),
            lifecycle: "initializing"
          })
        ]);
        installRuntimeReady(initialSnapshot, context);
        return projectionAcknowledgement(initialSnapshot.sessionId) as never;
      }
      if (type === "workspace.changes") return emptyWorkspaceChanges(initialSnapshot.sessionId) as never;
      throw new Error(`Unexpected request: ${type}`);
    });

    await openRendererWorkspace();

    expect(requestOrder.filter((type) => type !== "workspace.changes")).toEqual([
      "workspace.register",
      "session.catalog.query",
      "workspace.open",
      "session.catalog.query"
    ]);
    expect(request.mock.calls.filter(([type]) => type === "workspace.open")).toHaveLength(1);
    expect(request.mock.calls.filter(([type]) => type === "runtime.initialize")).toHaveLength(0);
    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([
      expect.objectContaining({
        conversation: expect.objectContaining({
          kind: "session",
          sessionFileIdentity: initialSnapshot.sessionFileIdentity,
          sessionPath: initialSnapshot.sessionPath
        }),
        sessionId: initialSnapshot.sessionId,
        lifecycle: "idle"
      })
    ]);
  });

  it("does not create a provisional Task while the Catalog is still rebuilding", async () => {
    vi.useFakeTimers();
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.register") return { registered: true } as never;
      if (type === "session.catalog.query") return rebuildingCatalogPage() as never;
      throw new Error(`Unexpected request: ${type}`);
    });

    const opening = openRendererWorkspace();
    await vi.advanceTimersByTimeAsync(0);

    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([]);
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: true,
      workspaceOpenPending: true
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(opening).resolves.toBeUndefined();

    expect(request.mock.calls.filter(([type]) => type === "workspace.open")).toHaveLength(0);
    expect(request.mock.calls.filter(([type]) => type === "runtime.initialize")).toHaveLength(0);
    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([]);
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      workspaceOpenPending: false,
      runtime: {
        phase: "stopped",
        detail: "Session 目录暂不可用，尚未确认没有会话。"
      }
    });
  });

  it("ends the opening decision budget even when the Catalog IPC acknowledgement hangs", async () => {
    vi.useFakeTimers();
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.register") return { registered: true } as never;
      if (type === "session.catalog.query") {
        return await new Promise<never>(() => undefined);
      }
      throw new Error(`Unexpected request: ${type}`);
    });

    const opening = openRendererWorkspace();
    await vi.advanceTimersByTimeAsync(0);

    expect(request.mock.calls.filter(([type]) => type === "session.catalog.query")).toHaveLength(1);
    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([]);

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(opening).resolves.toBeUndefined();

    expect(request.mock.calls.filter(([type]) => type === "workspace.open")).toHaveLength(0);
    expect(request.mock.calls.filter(([type]) => type === "runtime.initialize")).toHaveLength(0);
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      workspaceOpenPending: false,
      runtime: {
        phase: "stopped",
        detail: "Session 目录暂不可用，尚未确认没有会话。"
      }
    });
  });

  it("opens the persisted Session while a rebuilding Catalog has no rows yet", async () => {
    const descriptor = workspaceDescriptorFixture();
    const initialSnapshot = snapshot();
    const conversation = {
      kind: "session" as const,
      workspaceId: descriptor.id,
      sessionFileIdentity: initialSnapshot.sessionFileIdentity,
      sessionPath: initialSnapshot.sessionPath
    };
    const workbench = rendererWorkbenchStore.getState();
    workbench.registerWorkspace(descriptor);
    workbench.selectConversation(conversation);
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (
      type,
      _requestPayload,
      _transfer,
      options
    ) => {
      if (type === "workspace.register") return { registered: true } as never;
      if (type === "session.catalog.query") return rebuildingCatalogPage() as never;
      if (type === "runtime.initialize") {
        const context = options?.context;
        if (!context || context.scope !== "task") throw new Error("Expected Task context.");
        installRuntimeReady(initialSnapshot, context);
        return projectionAcknowledgement(initialSnapshot.sessionId) as never;
      }
      if (type === "workspace.changes") return emptyWorkspaceChanges(initialSnapshot.sessionId) as never;
      throw new Error(`Unexpected request: ${type}`);
    });

    await expect(openRendererWorkspaceDescriptor(descriptor)).resolves.toBe(true);

    expect(request.mock.calls.filter(([type]) => type === "runtime.initialize")).toHaveLength(1);
    expect(request.mock.calls.filter(([type]) => type === "workspace.open")).toHaveLength(0);
    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([
      expect.objectContaining({
        conversation,
        sessionId: initialSnapshot.sessionId,
        lifecycle: "idle"
      })
    ]);
  });
});

function installRuntimeReady(
  initialSnapshot: ReturnType<typeof snapshot>,
  context: Extract<NonNullable<Parameters<typeof agentConnectionController.request>[3]>["context"], { scope: "task" }>
): void {
  const payload = {
    capabilities: workspaceRuntimeCapabilities(),
    snapshot: initialSnapshot,
    taskToolMode: "auto" as const
  };
  const envelope = eventEnvelope("runtime.ready", payload, taskEventFixture({
    hostEpoch: 9,
    sequence: 2,
    workspaceId: context.workspaceId,
    taskId: context.taskId,
    taskGeneration: context.taskGeneration,
    sessionId: initialSnapshot.sessionId,
    sessionFileIdentity: initialSnapshot.sessionFileIdentity,
    sessionGeneration: 1
  }));
  applyRendererAgentEvent({ type: "runtime.ready", payload }, envelope);
}

function resetStores(): void {
  resetWorkspaceHostRegistrationState();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  rendererWorkbenchStore.getState().reset();
}

function snapshot(): SessionSnapshot & { sessionFileIdentity: string; sessionPath: string } {
  return {
    sessionId: "session-initial",
    sessionFileIdentity: "session-file-fixture-session-initial",
    sessionPath: "/sessions/session-initial.jsonl",
    cwd: "/workspace-next",
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

function catalogPageForSnapshot(
  value: SessionSnapshot & { sessionFileIdentity: string; sessionPath: string }
): SessionCatalogPage {
  return {
    revision: 1,
    itemCount: 1,
    source: "sqlite",
    state: "ready",
    rebuilding: false,
    incomplete: false,
    skippedCount: 0,
    items: [{
      fileIdentity: `session-file-fixture-${value.sessionId}`,
      id: value.sessionId,
      path: value.sessionPath,
      cwd: value.cwd,
      name: "未命名会话",
      nameSource: "fallback",
      modifiedAt: 1,
      messageCount: 0
    }],
    total: 1,
    hasMore: false
  };
}

function emptyCatalogPage(): SessionCatalogPage {
  return {
    revision: 1,
    itemCount: 0,
    source: "sqlite",
    state: "ready",
    rebuilding: false,
    incomplete: false,
    skippedCount: 0,
    items: [],
    total: 0,
    hasMore: false
  };
}

function rebuildingCatalogPage(): SessionCatalogPage {
  return {
    ...emptyCatalogPage(),
    state: "rebuilding",
    rebuilding: true
  };
}

function projectionAcknowledgement(sessionId: string) {
  return {
    accepted: true as const,
    hostEpoch: 9,
    sessionId,
    sessionFileIdentity: `session-file-fixture-${sessionId}`,
    sessionGeneration: 1,
    eventSequence: 2
  };
}
