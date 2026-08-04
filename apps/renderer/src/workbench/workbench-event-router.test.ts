import type {
  RuntimeCapabilities,
  RuntimeStatus,
  SessionSnapshot
} from "@pi67/domain";
import {
  eventEnvelope,
  type AgentEvent,
  type EventEnvelope,
  type EventPayloads
} from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { rendererWorkbenchStore } from "./workbench-store.js";
import { routeWorkbenchAgentEvent } from "./workbench-event-router.js";

describe("workbench event routing", () => {
  beforeEach(() => rendererWorkbenchStore.getState().reset());

  it("updates a background task without making its projection active", () => {
    const workbench = rendererWorkbenchStore.getState();
    workbench.registerWorkspace({
      id: "workspace-a",
      displayName: "A",
      identity: { canonicalPath: "/work/a", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    workbench.openTask(task("active"));
    workbench.openTask(task("background"));
    workbench.selectTask("active");
    const payload = { operation: {
      operationId: "operation-background",
      kind: "prompt" as const,
      lifecycle: "running" as const,
      cancellable: true,
      sessionId: "session-background",
      sessionGeneration: 2,
      startedAt: 1
    } };

    const route = routeWorkbenchAgentEvent(
      { type: "operation.started", payload },
      eventEnvelope("operation.started", payload, taskEventFixture({
        hostEpoch: 9,
        sequence: 1,
        workspaceId: "workspace-a",
        taskId: "background",
        taskGeneration: 1,
        sessionId: "session-background",
        sessionGeneration: 2,
        operationId: "operation-background"
      }))
    );

    expect(route).toBe("background");
    expect(rendererWorkbenchStore.getState().tasks.background?.lifecycle).toBe("running");
    expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({
      kind: "conversation",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionPath: "/sessions/active.jsonl"
      }
    });
  });

  it("routes Tool mode changes to the addressed background Task only", () => {
    const workbench = rendererWorkbenchStore.getState();
    workbench.registerWorkspace({
      id: "workspace-a",
      displayName: "A",
      identity: { canonicalPath: "/work/a", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    workbench.openTask(task("active"));
    workbench.openTask(task("background"));
    workbench.selectTask("active");
    const payload = { mode: "yolo" as const, reason: "user-selected" as const };

    expect(routeWorkbenchAgentEvent(
      { type: "task.toolMode.changed", payload },
      eventEnvelope("task.toolMode.changed", payload, taskEventFixture({
        hostEpoch: 9,
        sequence: 1,
        workspaceId: "workspace-a",
        taskId: "background",
        taskGeneration: 1,
        sessionId: "session-background",
        sessionGeneration: 2
      }))
    )).toBe("background");

    expect(rendererWorkbenchStore.getState().tasks.active?.toolMode).toBe("auto");
    expect(rendererWorkbenchStore.getState().tasks.background?.toolMode).toBe("yolo");
    expect(rendererWorkbenchStore.getState().selectedSurface).toMatchObject({
      conversation: { sessionPath: "/sessions/active.jsonl" }
    });
  });

  it("rejects a stale task generation", () => {
    const workbench = rendererWorkbenchStore.getState();
    workbench.registerWorkspace({
      id: "workspace-a",
      displayName: "A",
      identity: { canonicalPath: "/work/a", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    workbench.openTask(task("active"));
    const status: RuntimeStatus = { phase: "busy", detail: "stale", recoverable: true };

    expect(routeWorkbenchAgentEvent(
      { type: "runtime.statusChanged", payload: status },
      eventEnvelope("runtime.statusChanged", status, taskEventFixture({
        hostEpoch: 9,
        sequence: 1,
        workspaceId: "workspace-a",
        taskId: "active",
        taskGeneration: 2
      }))
    )).toBe("stale");
    expect(rendererWorkbenchStore.getState().tasks.active?.runtime.phase).toBe("ready");
  });

  it.each(staleSessionEventCases())("rejects %s from an old Session identity", (_name, createEvent) => {
    for (const authority of [
      { sessionId: "session-old", sessionGeneration: 2 },
      { sessionId: "session-active", sessionGeneration: 1 }
    ]) {
      openActiveTask();
      const before = structuredClone(rendererWorkbenchStore.getState().tasks.active);
      const { event, envelope } = createEvent(authority);

      expect(routeWorkbenchAgentEvent(event, envelope)).toBe("stale");
      expect(rendererWorkbenchStore.getState().tasks.active).toEqual(before);
    }
  });

  it("passes Session-scoped events that do not update the Workbench Task summary", () => {
    openActiveTask();
    const before = structuredClone(rendererWorkbenchStore.getState().tasks.active);
    const { event, envelope } = routedEvent(
      "extension.catalog.changed",
      { items: [], total: 0, truncated: false },
      { sessionId: "session-old", sessionGeneration: 1 }
    );

    expect(routeWorkbenchAgentEvent(event, envelope)).toBe("active");
    expect(rendererWorkbenchStore.getState().tasks.active).toEqual(before);
  });

  it("installs a new Session identity from runtime.ready", () => {
    openActiveProvisionalTask();
    const readySnapshot = snapshot("session-ready", "/sessions/ready.jsonl", "Ready Session");
    const payload = {
      capabilities: runtimeCapabilities(),
      snapshot: readySnapshot,
      taskToolMode: "yolo" as const
    };

    expect(routeWorkbenchAgentEvent(
      { type: "runtime.ready", payload },
      eventEnvelope("runtime.ready", payload, taskEventFixture({
        hostEpoch: 9,
        sequence: 2,
        workspaceId: "workspace-a",
        taskId: "active",
        taskGeneration: 1,
        sessionId: readySnapshot.sessionId,
        sessionGeneration: 3
      }))
    )).toBe("active");
    expect(rendererWorkbenchStore.getState().tasks.active).toMatchObject({
      sessionId: "session-ready",
      sessionGeneration: 3,
      conversation: { kind: "provisional", workspaceId: "workspace-a" },
      title: "Ready Session",
      lifecycle: "idle",
      runtime: { phase: "ready" },
      toolMode: "yolo"
    });
    expect(rendererWorkbenchStore.getState().tasks.active?.sessionPath).toBeUndefined();
  });

  it("installs a new Session identity from session.bootstrap", () => {
    openActiveProvisionalTask();
    const bootstrapSnapshot = snapshot("session-bootstrap", "/sessions/bootstrap.jsonl", "Bootstrap Session");
    const payload = { snapshot: bootstrapSnapshot, reason: "session-open" as const };

    expect(routeWorkbenchAgentEvent(
      { type: "session.bootstrap", payload },
      eventEnvelope("session.bootstrap", payload, taskEventFixture({
        hostEpoch: 9,
        sequence: 2,
        workspaceId: "workspace-a",
        taskId: "active",
        taskGeneration: 1,
        sessionId: bootstrapSnapshot.sessionId,
        sessionGeneration: 4
      }))
    )).toBe("active");
    expect(rendererWorkbenchStore.getState().tasks.active).toMatchObject({
      sessionId: "session-bootstrap",
      sessionGeneration: 4,
      conversation: { kind: "provisional", workspaceId: "workspace-a" },
      title: "Bootstrap Session",
      lifecycle: "idle",
      runtime: { phase: "ready" },
      toolMode: "auto"
    });
    expect(rendererWorkbenchStore.getState().tasks.active?.sessionPath).toBeUndefined();
  });

  it("keeps the originating task active while Settings is open", () => {
    const workbench = rendererWorkbenchStore.getState();
    workbench.registerWorkspace({
      id: "workspace-a",
      displayName: "A",
      identity: { canonicalPath: "/work/a", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    workbench.openTask(task("active"));
    workbench.openSettings("runtime");
    const status: RuntimeStatus = { phase: "busy", detail: "starting", recoverable: true };

    expect(routeWorkbenchAgentEvent(
      { type: "runtime.statusChanged", payload: status },
      eventEnvelope("runtime.statusChanged", status, taskEventFixture({
        hostEpoch: 9,
        sequence: 1,
        workspaceId: "workspace-a",
        taskId: "active",
        taskGeneration: 1,
        sessionId: "session-active",
        sessionGeneration: 2
      }))
    )).toBe("active");
    expect(rendererWorkbenchStore.getState()).toMatchObject({
      selectedSurface: { kind: "settings" },
      settingsReturnSurface: {
        kind: "conversation",
        conversation: { sessionPath: "/sessions/active.jsonl" }
      },
      tasks: { active: { runtime: status } }
    });
  });
});

interface SessionAuthorityFixture {
  sessionId: string;
  sessionGeneration: number;
}

interface RoutedEventFixture {
  event: AgentEvent;
  envelope: EventEnvelope;
}

type StaleSessionEventFactory = (authority: SessionAuthorityFixture) => RoutedEventFixture;

function staleSessionEventCases(): ReadonlyArray<readonly [string, StaleSessionEventFactory]> {
  return [
    ["operation.started", (authority) => {
      const operationId = "operation-stale";
      const payload = { operation: {
        operationId,
        kind: "prompt" as const,
        lifecycle: "running" as const,
        cancellable: true,
        sessionId: authority.sessionId,
        sessionGeneration: authority.sessionGeneration,
        startedAt: 1
      } };
      return routedEvent("operation.started", payload, authority, operationId);
    }],
    ["operation.completed", (authority) => {
      const operationId = "operation-stale";
      return routedEvent(
        "operation.completed",
        { operationId, completedAt: 2 },
        authority,
        operationId
      );
    }],
    ["runtime.statusChanged", (authority) => routedEvent(
      "runtime.statusChanged",
      { phase: "busy", detail: "stale", recoverable: true },
      authority
    )],
    ["task.toolMode.changed", (authority) => routedEvent(
      "task.toolMode.changed",
      { mode: "yolo", reason: "user-selected" },
      authority
    )],
    ["session.metaChanged", (authority) => routedEvent(
      "session.metaChanged",
      {
        streaming: false,
        sessionName: "Stale Session",
        thinkingLevel: "off"
      },
      authority
    )]
  ];
}

function routedEvent<Type extends AgentEvent["type"]>(
  type: Type,
  payload: EventPayloads[Type],
  authority: SessionAuthorityFixture,
  operationId?: string
): RoutedEventFixture {
  return {
    event: { type, payload } as AgentEvent,
    envelope: eventEnvelope(type, payload, taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      workspaceId: "workspace-a",
      taskId: "active",
      taskGeneration: 1,
      sessionId: authority.sessionId,
      sessionGeneration: authority.sessionGeneration,
      ...(operationId === undefined ? {} : { operationId })
    })) as EventEnvelope
  };
}

function openActiveTask(): void {
  const workbench = rendererWorkbenchStore.getState();
  workbench.reset();
  rendererWorkbenchStore.getState().registerWorkspace({
    id: "workspace-a",
    displayName: "A",
    identity: { canonicalPath: "/work/a", assurance: "filesystem" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  });
  rendererWorkbenchStore.getState().openTask(task("active"));
}

function openActiveProvisionalTask(): void {
  const workbench = rendererWorkbenchStore.getState();
  workbench.reset();
  workbench.registerWorkspace({
    id: "workspace-a",
    displayName: "A",
    identity: { canonicalPath: "/work/a", assurance: "filesystem" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  });
  workbench.openTask({
    ...task("active"),
    conversation: { kind: "provisional", workspaceId: "workspace-a", draftId: "active" },
    creationStatus: "pending"
  });
}

function snapshot(sessionId: string, sessionPath: string, sessionName: string): SessionSnapshot {
  return {
    sessionId,
    sessionPath,
    sessionName,
    cwd: "/work/a",
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

function task(id: string) {
  return {
    id,
    conversation: {
      kind: "session" as const,
      workspaceId: "workspace-a",
      sessionPath: `/sessions/${id}.jsonl`
    },
    workspaceId: "workspace-a",
    sessionId: `session-${id}`,
    sessionGeneration: 2,
    taskGeneration: 1,
    lifecycle: "idle" as const,
    runtime: { phase: "ready" as const, detail: "ready", recoverable: true },
    title: id,
    hasDraft: false,
    toolMode: "auto" as const,
    attachmentCount: 0
  };
}
