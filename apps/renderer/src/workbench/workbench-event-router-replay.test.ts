import { eventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { classifyWorkbenchAgentEvent } from "./workbench-event-router.js";
import { rendererWorkbenchStore } from "./workbench-store.js";

describe("workbench operation replay routing", () => {
  beforeEach(() => {
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
      id: "active",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-active",
        sessionPath: "/sessions/active.jsonl"
      },
      workspaceId: "workspace-a",
      sessionId: "session-active",
      sessionGeneration: 2,
      taskGeneration: 1,
      lifecycle: "completed",
      runtime: { phase: "ready", detail: "任务已完成", recoverable: true },
      operationId: "operation-complete",
      title: "active",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0
    });
  });

  it("does not let a replayed operation.started event revive a terminal Task", () => {
    const payload = { operation: {
      operationId: "operation-complete",
      kind: "prompt" as const,
      lifecycle: "running" as const,
      cancellable: true,
      sessionId: "session-active",
      sessionFileIdentity: "session-file-active",
      sessionGeneration: 2,
      startedAt: 1
    } };

    expect(classifyWorkbenchAgentEvent(
      { type: "operation.started", payload },
      eventEnvelope("operation.started", payload, taskEventFixture({
        hostEpoch: 9,
        sequence: 3,
        workspaceId: "workspace-a",
        taskId: "active",
        taskGeneration: 1,
        sessionId: "session-active",
        sessionGeneration: 2,
        operationId: "operation-complete"
      }))
    )).toBe("stale");
    expect(rendererWorkbenchStore.getState().tasks.active).toMatchObject({
      lifecycle: "completed",
      runtime: { phase: "ready" },
      operationId: "operation-complete"
    });
  });

  it("does not let delayed activity revive a terminal Task", () => {
    const payload = {
      operationId: "operation-complete",
      activity: { kind: "responding" as const }
    };

    expect(classifyWorkbenchAgentEvent(
      { type: "operation.activityChanged", payload },
      eventEnvelope("operation.activityChanged", payload, taskEventFixture({
        hostEpoch: 9,
        sequence: 4,
        workspaceId: "workspace-a",
        taskId: "active",
        taskGeneration: 1,
        sessionId: "session-active",
        sessionGeneration: 2,
        operationId: "operation-complete"
      }))
    )).toBe("stale");
    expect(rendererWorkbenchStore.getState().tasks.active?.lifecycle).toBe("completed");
  });
});
