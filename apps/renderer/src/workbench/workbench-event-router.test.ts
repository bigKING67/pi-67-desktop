import type { RuntimeStatus } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
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
