import type {
  OperationView,
  RuntimeCapabilities,
  SessionSnapshot,
  WorkspaceChangeView
} from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceChangesStore } from "../changes/workspace-changes-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { openRendererSession } from "../session/session-lifecycle-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useAppStore } from "./app-store.js";
import { applyRendererAgentEvent } from "./renderer-agent-event-controller.js";

const runningChange: WorkspaceChangeView = {
  kind: "edit",
  toolCallId: "tool-change-1",
  path: "src/file.ts",
  pathTruncated: false,
  status: "running",
  patchTruncated: false
};

describe("Workbench-selected App projection", () => {
  beforeEach(() => {
    resetStores();
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-1",
      displayName: "Workspace",
      identity: { canonicalPath: "/workspace", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    setSessionState("session-1", 3);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetStores();
  });

  it("clears recorded changes when the active Task bootstraps a new session identity", () => {
    vi.spyOn(agentConnectionController, "request").mockReturnValue(new Promise(() => undefined) as never);
    openWorkbenchTask("task-fixture", "session-1", 3);
    emitChange(runningChange);
    const nextSnapshot = snapshot("session-2");
    const event = { type: "session.bootstrap", payload: { snapshot: nextSnapshot, reason: "session-open" } } as const;
    const envelope = eventEnvelope(event.type, event.payload, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      workspaceId: "workspace-1",
      taskId: "task-fixture",
      sessionId: "session-2",
      sessionGeneration: 4
    }));

    expect(applyRendererAgentEvent(event, envelope)).toBe("active");

    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-2",
      sessionGeneration: 4
    });
    expect(useWorkspaceChangesStore.getState().projection).toBeUndefined();
    expect(useWorkspaceChangesStore.getState().status).toBe("loading");
    expect("messages" in useSessionProjectionStore.getState()).toBe(false);
    expect(useConversationStore.getState().authority?.sessionId).toBe("session-2");
  });

  it("does not commit a bootstrap from an unregistered Workbench Task", () => {
    emitChange(runningChange);
    const before = useWorkspaceChangesStore.getState();
    const event = {
      type: "session.bootstrap",
      payload: { snapshot: snapshot("session-2"), reason: "session-open" }
    } as const;
    const envelope = eventEnvelope(event.type, event.payload, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      workspaceId: "workspace-1",
      taskId: "missing-task",
      sessionId: "session-2",
      sessionGeneration: 4
    }));

    expect(applyRendererAgentEvent(event, envelope)).toBe("stale");
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-1"
    });
    expect(useWorkspaceChangesStore.getState().projection).toEqual(before.projection);
    expect(useWorkspaceChangesStore.getState().status).toBe(before.status);
  });

  it("commits a target bootstrap to both projections only after ignoring its empty runtime", () => {
    vi.spyOn(agentConnectionController, "request").mockReturnValue(new Promise(() => undefined) as never);
    openWorkbenchTask("task-fixture", "session-1", 3);
    useAppStore.setState({
      sessionTransitionPending: true,
      sessionBootstrapTransitionPending: true,
      runtime: { phase: "starting", detail: "Forking", recoverable: true }
    });
    const beforeTask = structuredClone(rendererWorkbenchStore.getState().tasks["task-fixture"]);
    const initialSnapshot = snapshot("session-target-initial");
    const readyEvent = {
      type: "runtime.ready",
      payload: {
        capabilities: runtimeCapabilities(),
        snapshot: initialSnapshot,
        taskToolMode: "auto" as const
      }
    } as const;
    const readyEnvelope = eventEnvelope(readyEvent.type, readyEvent.payload, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      workspaceId: "workspace-1",
      taskId: "task-fixture",
      taskGeneration: 1,
      sessionId: initialSnapshot.sessionId,
      sessionGeneration: 1
    }));

    expect(applyRendererAgentEvent(readyEvent, readyEnvelope)).toBe("active");
    expect(rendererWorkbenchStore.getState().tasks["task-fixture"]).toEqual(beforeTask);
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-1",
      sessionGeneration: 3
    });
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: true,
      sessionBootstrapTransitionPending: true,
      runtime: { phase: "starting", detail: "Forking" }
    });

    const targetSnapshot = snapshot("session-2");
    const bootstrapEvent = {
      type: "session.bootstrap",
      payload: { snapshot: targetSnapshot, reason: "session-fork" as const }
    } as const;
    const bootstrapEnvelope = eventEnvelope(
      bootstrapEvent.type,
      bootstrapEvent.payload,
      taskEventFixture({
        hostEpoch: 9,
        sequence: 3,
        workspaceId: "workspace-1",
        taskId: "task-fixture",
        taskGeneration: 1,
        sessionId: targetSnapshot.sessionId,
        sessionGeneration: 4
      })
    );

    expect(applyRendererAgentEvent(bootstrapEvent, bootstrapEnvelope)).toBe("active");
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-2",
      sessionGeneration: 4
    });
    expect(rendererWorkbenchStore.getState().tasks["task-fixture"]).toMatchObject({
      conversation: {
        kind: "session",
        workspaceId: "workspace-1",
        sessionPath: "/sessions/session-2.jsonl"
      },
      sessionId: "session-2",
      sessionPath: "/sessions/session-2.jsonl",
      sessionGeneration: 4,
      lifecycle: "idle",
      runtime: { phase: "ready" }
    });
    expect(useWorkspaceChangesStore.getState().status).toBe("loading");
  });

  it("rejects an import bootstrap whose Operation authority matches neither projection", () => {
    openWorkbenchTask("task-fixture", "session-1", 3);
    rendererWorkbenchStore.getState().updateTask("task-fixture", {
      lifecycle: "running",
      operationId: "operation-import"
    });
    useAppStore.setState({ operation: importOperation("session-1", 3) });
    const beforeTask = structuredClone(rendererWorkbenchStore.getState().tasks["task-fixture"]);
    const importedSnapshot = snapshot("session-imported");
    const event = {
      type: "session.bootstrap",
      payload: { snapshot: importedSnapshot, reason: "session-import" as const }
    } as const;
    const envelope = eventEnvelope(event.type, event.payload, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      workspaceId: "workspace-1",
      taskId: "task-fixture",
      taskGeneration: 1,
      sessionId: importedSnapshot.sessionId,
      sessionGeneration: 4,
      operationId: "operation-other"
    }));

    expect(applyRendererAgentEvent(event, envelope)).toBe("stale");
    expect(rendererWorkbenchStore.getState().tasks["task-fixture"]).toEqual(beforeTask);
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      phase: "active",
      sessionId: "session-1",
      sessionGeneration: 3
    });
    expect(useAppStore.getState().operation).toEqual(importOperation("session-1", 3));
  });

  it("does not split the requested path from an empty Session identity after open failure", async () => {
    const requestedPath = "/sessions/requested.jsonl";
    let targetTaskId: string | undefined;
    vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type !== "session.open") throw new Error(`Unexpected request: ${type}`);
      const targetTask = Object.values(rendererWorkbenchStore.getState().tasks).find(
        (task) => task.sessionPath === requestedPath
      );
      if (!targetTask) throw new Error("Expected pending Session Task.");
      targetTaskId = targetTask.id;
      const initialSnapshot = snapshot("session-target-initial");
      const readyEvent = {
        type: "runtime.ready",
        payload: {
          capabilities: runtimeCapabilities(),
          snapshot: initialSnapshot,
          taskToolMode: "auto" as const
        }
      } as const;
      const readyEnvelope = eventEnvelope(readyEvent.type, readyEvent.payload, taskEventFixture({
        hostEpoch: 9,
        sequence: 2,
        workspaceId: "workspace-1",
        taskId: targetTask.id,
        taskGeneration: targetTask.taskGeneration,
        sessionId: initialSnapshot.sessionId,
        sessionGeneration: 1
      }));

      expect(applyRendererAgentEvent(readyEvent, readyEnvelope)).toBe("active");
      expect(rendererWorkbenchStore.getState().tasks[targetTask.id]).toMatchObject({
        conversation: {
          kind: "session",
          workspaceId: "workspace-1",
          sessionPath: requestedPath
        },
        sessionId: targetTask.sessionId,
        sessionPath: requestedPath,
        lifecycle: "initializing"
      });
      throw new Error("session.open failed");
    });

    await openRendererSession(requestedPath);

    expect(targetTaskId).toBeDefined();
    const failedTask = targetTaskId
      ? rendererWorkbenchStore.getState().tasks[targetTaskId]
      : undefined;
    expect(failedTask).toMatchObject({
      conversation: {
        kind: "session",
        workspaceId: "workspace-1",
        sessionPath: requestedPath
      },
      sessionPath: requestedPath,
      lifecycle: "failed",
      runtime: { phase: "failed" }
    });
    expect(failedTask?.sessionId).toMatch(/^pending:/);
    expect(failedTask?.sessionId).not.toBe("session-target-initial");
  });
});

function resetStores(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useConversationStore.getState().reset();
  useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  rendererWorkbenchStore.getState().reset();
}

function setSessionState(sessionId: string, sessionGeneration: number): void {
  useAppStore.setState({ connected: true, hostEpoch: 9 });
  const authority = installSessionProjectionFixture(useAppStore.getState(), snapshot(sessionId), sessionGeneration);
  if (!authority) throw new Error("Expected Session projection fixture authority.");
  useWorkspaceChangesStore.getState().beginSession(authority);
}

function openWorkbenchTask(taskId: string, sessionId: string, sessionGeneration: number): void {
  rendererWorkbenchStore.getState().openTask({
    id: taskId,
    conversation: {
      kind: "session",
      workspaceId: "workspace-1",
      sessionPath: `/sessions/${sessionId}.jsonl`
    },
    workspaceId: "workspace-1",
    sessionId,
    sessionGeneration,
    taskGeneration: 1,
    lifecycle: "idle",
    runtime: { phase: "ready", detail: "Pi 会话已就绪", recoverable: true },
    title: sessionId,
    hasDraft: false,
    toolMode: "auto",
    attachmentCount: 0
  });
}

function emitChange(change: WorkspaceChangeView): void {
  const event = { type: "workspace.changeChanged", payload: { sessionId: "session-1", change } } as const;
  useAppStore.getState().receiveAgentEvent(event, eventEnvelope(event.type, event.payload, taskEventFixture({
    hostEpoch: 9,
    sequence: 1,
    sessionId: "session-1",
    sessionGeneration: 3
  })));
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

function importOperation(sessionId: string, sessionGeneration: number): OperationView {
  return {
    operationId: "operation-import",
    kind: "session-import",
    lifecycle: "running",
    cancellable: false,
    sessionId,
    sessionGeneration,
    startedAt: 1
  };
}

function runtimeCapabilities(): RuntimeCapabilities {
  return {
    sdkVersion: "test",
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
