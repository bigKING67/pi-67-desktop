import type { OperationView, ToolExecutionView } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { taskEventFixture } from "../connection/protocol-test-fixtures.js";
import { useOperationActivityTimelineStore } from "../operation/operation-activity-timeline-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  installSessionProjectionFixture,
  sessionSnapshotFixture
} from "../session/session-projection-test-support.js";
import { handleAgentEvent } from "./app-events.js";

const operation: OperationView = {
  operationId: "operation-1",
  kind: "prompt",
  lifecycle: "running",
  cancellable: true,
  sessionId: "session-1",
  sessionFileIdentity: "session-file-session-1",
  sessionGeneration: 3,
  startedAt: 1
};

describe("Tool execution App events", () => {
  beforeEach(() => {
    useOperationActivityTimelineStore.getState().reset();
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    installSessionProjectionFixture(
      { connected: true, hostEpoch: 9 },
      sessionSnapshotFixture(),
      3
    );
  });

  it("applies keyed Tool execution events to the Operation and timeline", () => {
    const state = eventState();
    const execution: ToolExecutionView = {
      toolCallId: "tool-1",
      toolName: "bash",
      toolKind: "shell",
      status: "failed",
      projectionSource: "live",
      resultState: "present",
      startedAt: 10,
      completedAt: 20,
      durationMs: 10,
      failure: {
        detailState: "available",
        source: "runtime-event",
        message: { text: "exit code 1", truncated: false }
      }
    };
    useOperationActivityTimelineStore.getState().begin(operation);
    expect(dispatchExecution(state, operation.operationId, execution)).toBe(true);
    expect(state.operation.toolExecutions).toEqual([execution]);
    expect(useOperationActivityTimelineStore.getState().timeline?.steps.at(-1)).toMatchObject({
      status: "failed",
      startedAt: 10,
      settledAt: 20,
      toolExecution: execution
    });
  });

  it("rejects another Operation and bounds keyed executions for the active Operation", () => {
    const state = eventState();
    const first = execution("tool-0", "running");
    expect(dispatchExecution(state, "operation-stale", first)).toBe(false);
    expect(state.operation.toolExecutions).toBeUndefined();

    for (let index = 0; index < 65; index += 1) {
      expect(dispatchExecution(
        state,
        operation.operationId,
        execution(`tool-${index}`, index === 0 ? "completed" : "running")
      )).toBe(true);
    }
    const replacement = execution("tool-64", "failed");
    expect(dispatchExecution(state, operation.operationId, replacement)).toBe(true);

    expect(state.operation.toolExecutions).toHaveLength(64);
    expect(state.operation.toolExecutions?.[0]?.toolCallId).toBe("tool-1");
    expect(state.operation.toolExecutions?.at(-1)).toEqual(replacement);
    expect(state.operation.toolExecutionsTruncated).toBe(true);
  });
});

function dispatchExecution(
  state: ReturnType<typeof eventState>,
  operationId: string,
  projected: ToolExecutionView
): boolean {
  const envelope = eventEnvelope(
    "operation.toolExecutionChanged",
    { operationId, execution: projected },
    taskEventFixture({
      hostEpoch: 9,
      sequence: 1,
      sessionId: operation.sessionId,
      sessionGeneration: operation.sessionGeneration,
      operationId
    })
  );
  return handleAgentEvent(
    { type: "operation.toolExecutionChanged", payload: envelope.payload },
    envelope,
    () => state,
    (update) => Object.assign(state, typeof update === "function" ? update(state) : update)
  );
}

function execution(
  toolCallId: string,
  status: ToolExecutionView["status"]
): ToolExecutionView {
  return {
    toolCallId,
    toolName: "bash",
    toolKind: "shell",
    status,
    projectionSource: "live",
    resultState: status === "running" ? "pending" : "present"
  };
}

function eventState() {
  return {
    connected: true,
    hostEpoch: 9,
    runtime: { phase: "busy" as const, detail: "运行中", recoverable: true },
    operation,
    operationDetail: undefined as string | undefined,
    operationProgress: undefined as string | undefined,
    sessionTransitionPending: false
  };
}
