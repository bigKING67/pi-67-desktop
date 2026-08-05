import type { RuntimeStatus } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask
} from "../workbench/workbench-store.js";
import { useAppStore } from "./app-store.js";
import { applyRendererAgentEvent } from "./renderer-agent-event-controller.js";

describe("renderer Agent event projection matrix", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
    rendererWorkbenchStore.getState().reset();
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-a",
      displayName: "A",
      identity: { canonicalPath: "/work/a", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    rendererWorkbenchStore.getState().openTask(task("active"));
    rendererWorkbenchStore.getState().openTask(task("background"));
    rendererWorkbenchStore.getState().selectTask("active");
    useAppStore.setState({
      connected: true,
      hostEpoch: 9,
      workspace: "/work/a",
      runtime: { phase: "ready", detail: "active ready", recoverable: true }
    });
  });

  it("updates a background Task without overwriting the active App projection", () => {
    const payload = { operation: {
      operationId: "operation-background",
      kind: "prompt" as const,
      lifecycle: "running" as const,
      cancellable: true,
      sessionId: "session-background",
      sessionGeneration: 2,
      startedAt: 1
    } };

    expect(applyRendererAgentEvent(
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
    )).toBe("background");
    expect(rendererWorkbenchStore.getState().tasks.background?.lifecycle).toBe("running");
    expect(useAppStore.getState()).toMatchObject({
      operation: undefined,
      runtime: { phase: "ready", detail: "active ready" }
    });
  });

  it("rejects a stale Task generation before either projection changes", () => {
    const status: RuntimeStatus = { phase: "busy", detail: "stale", recoverable: true };

    expect(applyRendererAgentEvent(
      { type: "runtime.statusChanged", payload: status },
      statusEnvelope(status, 2)
    )).toBe("stale");
    expect(rendererWorkbenchStore.getState().tasks.active?.runtime.detail).toBe("ready");
    expect(useAppStore.getState().runtime.detail).toBe("active ready");
  });

  it("rejects a background terminal without a current Operation authority", () => {
    const payload = { operationId: "operation-ghost", completedAt: 2 };

    expect(applyRendererAgentEvent(
      { type: "operation.completed", payload },
      eventEnvelope("operation.completed", payload, taskEventFixture({
        hostEpoch: 9,
        sequence: 2,
        workspaceId: "workspace-a",
        taskId: "background",
        taskGeneration: 1,
        sessionId: "session-background",
        sessionGeneration: 2,
        operationId: "operation-ghost"
      }))
    )).toBe("stale");
    expect(rendererWorkbenchStore.getState().tasks.background?.lifecycle).toBe("idle");
    expect(rendererWorkbenchStore.getState().tasks.background).not.toHaveProperty("operationId");
    expect(useAppStore.getState().operation).toBeUndefined();
  });

  it("keeps the Settings return Task active and projects its event to both stores", () => {
    rendererWorkbenchStore.getState().openSettings("runtime");
    const status: RuntimeStatus = { phase: "busy", detail: "running", recoverable: true };

    expect(applyRendererAgentEvent(
      { type: "runtime.statusChanged", payload: status },
      statusEnvelope(status, 1)
    )).toBe("active");
    expect(rendererWorkbenchStore.getState()).toMatchObject({
      selectedSurface: { kind: "settings" },
      settingsSection: "runtime",
      settingsScope: "global"
    });
    expect(rendererWorkbenchStore.getState().tasks.active?.runtime).toEqual(status);
    expect(useAppStore.getState().runtime).toEqual(status);
  });

  it("allows a lost Task summary while the selected live projection is recovering", () => {
    rendererWorkbenchStore.getState().updateTask("active", {
      lifecycle: "lost",
      runtime: { phase: "failed", detail: "Host stopped", recoverable: true }
    });
    useAppStore.setState({
      runtime: { phase: "recovering", detail: "Reconnecting Host", recoverable: true }
    });

    expect(selectedWorkbenchTask(rendererWorkbenchStore.getState())).toMatchObject({
      lifecycle: "lost",
      runtime: { phase: "failed" }
    });
    expect(useAppStore.getState().runtime.phase).toBe("recovering");
  });
});

function task(id: "active" | "background") {
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

function statusEnvelope(status: RuntimeStatus, taskGeneration: number) {
  return eventEnvelope("runtime.statusChanged", status, taskEventFixture({
    hostEpoch: 9,
    sequence: 1,
    workspaceId: "workspace-a",
    taskId: "active",
    taskGeneration,
    sessionId: "session-active",
    sessionGeneration: 2
  }));
}
