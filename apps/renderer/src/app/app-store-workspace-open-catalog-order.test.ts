import type {
  RuntimeCapabilities,
  SessionCatalogPage,
  SessionSnapshot,
  WorkspaceChangesProjection
} from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { openRendererWorkspace } from "../workspace/workspace-open-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { resetWorkspaceHostRegistrationState } from "../workbench/workspace-host-registration-controller.js";
import { useAppStore } from "./app-store.js";
import { applyRendererAgentEvent } from "./renderer-agent-event-controller.js";

describe("Workspace open Catalog ordering", () => {
  beforeEach(() => {
    resetStores();
    useAppStore.setState({ connected: true, hostEpoch: 9 });
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue(connectionIdentity());
    vi.stubGlobal("window", {
      pi67: { system: { selectWorkspace: vi.fn().mockResolvedValue("/workspace-next") } }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetStores();
  });

  it("opens the initial Runtime Session before publishing the first Catalog result", async () => {
    const requestOrder: string[] = [];
    const registration = deferred<void>();
    const catalogQuery = deferred<void>();
    let initialRuntimeOpened = false;
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
      if (type === "workspace.open") {
        initialRuntimeOpened = true;
        const context = options?.context;
        if (!context || context.scope !== "task") throw new Error("Expected Task context.");
        expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([
          expect.objectContaining({
            id: context.taskId,
            conversation: expect.objectContaining({
              kind: "provisional",
              workspaceId: context.workspaceId
            }),
            lifecycle: "initializing"
          })
        ]);
        const payload = {
          capabilities: runtimeCapabilities(),
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
          sessionGeneration: 1
        }));
        const event = { type: "runtime.ready", payload } as const;
        applyRendererAgentEvent(event, envelope);
        return projectionAcknowledgement(initialSnapshot.sessionId) as never;
      }
      if (type === "session.catalog.query") {
        expect(requestPayload).toEqual({ scope: "workspace", limit: 50, refresh: true });
        await catalogQuery.promise;
        return (initialRuntimeOpened
          ? catalogPageForSnapshot(initialSnapshot)
          : emptyCatalogPage()) as never;
      }
      if (type === "workspace.changes") return emptyChanges(initialSnapshot.sessionId) as never;
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
      sessionTransitionPending: false,
      workspaceOpenPending: true,
      runtime: { phase: "ready", detail: "Pi SDK 已就绪" }
    });
    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([
      expect.objectContaining({
        conversation: expect.objectContaining({
          kind: "session",
          sessionPath: initialSnapshot.sessionPath
        }),
        sessionId: initialSnapshot.sessionId,
        sessionPath: initialSnapshot.sessionPath
      })
    ]);

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
      "workspace.open",
      "session.catalog.query"
    ]);
    expect(request.mock.calls.filter(([type]) => type === "session.catalog.query")).toHaveLength(1);
    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toEqual([
      expect.objectContaining({
        conversation: expect.objectContaining({
          kind: "session",
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
});

function resetStores(): void {
  resetWorkspaceHostRegistrationState();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  rendererWorkbenchStore.getState().reset();
}

function snapshot(): SessionSnapshot & { sessionPath: string } {
  return {
    sessionId: "session-initial",
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
  value: SessionSnapshot & { sessionPath: string }
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

function projectionAcknowledgement(sessionId: string) {
  return {
    accepted: true as const,
    hostEpoch: 9,
    sessionId,
    sessionGeneration: 1,
    eventSequence: 2
  };
}

function connectionIdentity() {
  return {
    appInstanceId: "app-1",
    hostInstanceId: "host-9",
    hostEpoch: 9,
    sdkVersion: "0.81.1",
    eventSequence: 0
  };
}

function emptyChanges(sessionId: string): WorkspaceChangesProjection {
  return { sessionId, items: [], truncated: false, total: 0 };
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
