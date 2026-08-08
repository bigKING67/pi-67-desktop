import type { RuntimeStatus } from "@pi67/domain";
import {
  eventEnvelope
} from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import {
  conversationNeedsAttention,
  useConversationAttentionStore
} from "../navigation/conversation-attention-store.js";
import { rendererWorkbenchStore } from "./workbench-store.js";
import {
  openActiveProvisionalTask,
  openActiveTask,
  routeWorkbenchAgentEvent,
  routedEvent,
  runtimeCapabilities,
  snapshot,
  staleSessionEventCases,
  task
} from "./workbench-event-router-test-fixture.js";

describe("workbench event routing", () => {
  beforeEach(() => {
    rendererWorkbenchStore.getState().reset();
    useConversationAttentionStore.getState().reset();
  });

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
      sessionFileIdentity: "session-file-session-background",
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
        sessionFileIdentity: "session-file-session-active",
        sessionPath: "/sessions/active.jsonl"
      }
    });
  });

  it("marks terminal and interactive background events for later review", () => {
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
    workbench.updateTask("background", { lifecycle: "running", operationId: "operation-background" });
    const authority = taskEventFixture({
      hostEpoch: 9,
      sequence: 2,
      workspaceId: "workspace-a",
      taskId: "background",
      taskGeneration: 1,
      sessionId: "session-background",
      sessionGeneration: 2,
      operationId: "operation-background"
    });
    const completed = { operationId: "operation-background", completedAt: 2 };

    expect(routeWorkbenchAgentEvent(
      { type: "operation.completed", payload: completed },
      eventEnvelope("operation.completed", completed, authority)
    )).toBe("background");
    expect(conversationNeedsAttention(
      useConversationAttentionStore.getState(),
      "workspace-a",
      "session-file-session-background"
    )).toBe(true);

    useConversationAttentionStore.getState().clear("workspace-a", "session-file-session-background");
    workbench.updateTask("background", { lifecycle: "running", operationId: "operation-background-2" });
    const waiting = {
      operationId: "operation-background-2",
      activity: { kind: "approval" as const, requestId: "approval-1" }
    };
    expect(routeWorkbenchAgentEvent(
      { type: "operation.activityChanged", payload: waiting },
      eventEnvelope("operation.activityChanged", waiting, taskEventFixture({
        hostEpoch: 9,
        operationId: "operation-background-2",
        sequence: 3,
        workspaceId: "workspace-a",
        taskId: "background",
        taskGeneration: 1,
        sessionId: "session-background",
        sessionGeneration: 2
      }))
    )).toBe("background");
    expect(conversationNeedsAttention(
      useConversationAttentionStore.getState(),
      "workspace-a",
      "session-file-session-background"
    )).toBe(true);
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
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionPath: "/sessions/ready.jsonl"
      },
      title: "Ready Session",
      lifecycle: "idle",
      runtime: { phase: "ready" },
      toolMode: "yolo"
    });
    expect(rendererWorkbenchStore.getState().tasks.active?.sessionPath).toBe("/sessions/ready.jsonl");
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
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionPath: "/sessions/bootstrap.jsonl"
      },
      title: "Bootstrap Session",
      lifecycle: "idle",
      runtime: { phase: "ready" },
      toolMode: "auto"
    });
    expect(rendererWorkbenchStore.getState().tasks.active?.sessionPath).toBe("/sessions/bootstrap.jsonl");
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
