import { describe, expect, it } from "vitest";
import {
  eventEnvelope,
  isEventEnvelope,
  isResponseEnvelope,
  responseEnvelope
} from "./envelope.js";

describe("tool execution protocol", () => {
  it("accepts the bounded lifecycle event and rejects raw Tool payloads", () => {
    const value = eventEnvelope("operation.toolExecutionChanged", {
      operationId: "operation-1",
      execution: execution()
    }, eventContext());

    expect(isEventEnvelope(value)).toBe(true);
    expect(isEventEnvelope({
      ...value,
      payload: {
        ...value.payload,
        execution: { ...value.payload.execution, rawResult: { private: true } }
      }
    })).toBe(false);
    expect(isEventEnvelope({
      ...value,
      payload: {
        ...value.payload,
        execution: { ...value.payload.execution, progress: { text: "x".repeat(4_097), truncated: false } }
      }
    })).toBe(false);
    expect(isEventEnvelope({
      ...value,
      context: { ...value.context, operationId: "operation-other" }
    })).toBe(false);
  });

  it("accepts active Operation resync with bounded Tool executions", () => {
    const started = eventEnvelope("operation.started", {
      operation: {
        operationId: "operation-1",
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-1",
        sessionFileIdentity: "session-file-1",
        sessionGeneration: 2,
        startedAt: 1,
        toolExecutions: [execution()]
      }
    }, eventContext());

    expect(isEventEnvelope(started)).toBe(true);
  });

  it.each(["pending", "running", "completed", "failed", "interrupted", "cancelled", "lost", "unreconciled"] as const)(
    "accepts Tool status %s in durable message projection",
    (status) => {
      const response = responseEnvelope("request-1", 3, taskContext(), {
        ok: true,
        type: "message.page",
        result: {
          sessionId: "session-1",
          messages: [{
            id: "assistant-1",
            role: "assistant",
            parts: [{
              type: "tool-call",
              id: "tool-1",
              name: "bash",
              status,
              execution: { ...execution(), status }
            }]
          }],
          hasOlder: false,
          hasNewer: false
        }
      });

      expect(isResponseEnvelope(response)).toBe(true);
    }
  );
});

function execution() {
  return {
    toolCallId: "tool-1",
    toolName: "bash",
    toolKind: "shell" as const,
    status: "failed" as const,
    projectionSource: "live" as const,
    inputSummary: { text: "{\"command\":\"pnpm test\"}", truncated: false },
    command: { text: "pnpm test", truncated: false },
    cwd: "D:/code/pi-67-desktop",
    progress: { text: "1 test failed", truncated: false },
    resultState: "present" as const,
    failure: {
      detailState: "available" as const,
      source: "runtime-event" as const,
      message: { text: "exit code 1", truncated: false }
    },
    startedAt: 10,
    completedAt: 20,
    durationMs: 10,
    timingSource: "runtime" as const
  };
}

function taskContext() {
  return eventContext().context;
}

function eventContext() {
  return {
    hostEpoch: 3,
    sequence: 1,
    context: {
      scope: "task" as const,
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskGeneration: 1,
      sessionId: "session-1",
      sessionFileIdentity: "session-file-1",
      sessionGeneration: 2,
      operationId: "operation-1"
    },
    taskSequence: 1
  };
}
