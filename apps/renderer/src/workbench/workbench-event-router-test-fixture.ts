import type { RuntimeCapabilities, SessionSnapshot } from "@pi67/domain";
import {
  eventEnvelope,
  type AgentEvent,
  type EventEnvelope,
  type EventPayloads
} from "@pi67/protocol";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { rendererWorkbenchStore } from "./workbench-store.js";
import {
  applyWorkbenchAgentEvent,
  classifyWorkbenchAgentEvent,
  type WorkbenchEventRoute
} from "./workbench-event-router.js";

interface SessionAuthorityFixture {
  sessionId: string;
  sessionGeneration: number;
}

interface RoutedEventFixture {
  event: AgentEvent;
  envelope: EventEnvelope;
}

type StaleSessionEventFactory = (authority: SessionAuthorityFixture) => RoutedEventFixture;

export function staleSessionEventCases(): ReadonlyArray<readonly [string, StaleSessionEventFactory]> {
  return [
    ["operation.started", (authority) => {
      const operationId = "operation-stale";
      const payload = { operation: {
        operationId,
        kind: "prompt" as const,
        lifecycle: "running" as const,
        cancellable: true,
        sessionId: authority.sessionId,
        sessionFileIdentity: `session-file-${authority.sessionId}`,
        sessionGeneration: authority.sessionGeneration,
        startedAt: 1
      } };
      return routedEvent("operation.started", payload, authority, operationId);
    }],
    ["operation.completed", (authority) => {
      const operationId = "operation-stale";
      return routedEvent("operation.completed", { operationId, completedAt: 2 }, authority, operationId);
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
      { streaming: false, sessionName: "Stale Session", thinkingLevel: "off" },
      authority
    )]
  ];
}

export function routedEvent<Type extends AgentEvent["type"]>(
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

export function openActiveTask(): void {
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
  workbench.openTask(task("active"));
}

export function openActiveProvisionalTask(): void {
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

export function snapshot(sessionId: string, sessionPath: string, sessionName: string): SessionSnapshot {
  return {
    sessionId,
    sessionFileIdentity: `session-file-${sessionId}`,
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

export function runtimeCapabilities(): RuntimeCapabilities {
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

export function task(id: string) {
  return {
    id,
    conversation: {
      kind: "session" as const,
      workspaceId: "workspace-a",
      sessionFileIdentity: `session-file-session-${id}`,
      sessionPath: `/sessions/${id}.jsonl`
    },
    workspaceId: "workspace-a",
    sessionId: `session-${id}`,
    sessionFileIdentity: `session-file-session-${id}`,
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

export function routeWorkbenchAgentEvent(event: AgentEvent, envelope: EventEnvelope): WorkbenchEventRoute {
  const route = classifyWorkbenchAgentEvent(event, envelope);
  if (route === "active" || route === "background") applyWorkbenchAgentEvent(event, envelope);
  return route;
}
