import { describe, expect, it } from "vitest";
import { eventEnvelope, isEventEnvelope } from "./envelope.js";

describe("operation heartbeat protocol", () => {
  it("accepts authority-bound heartbeat timestamps", () => {
    const heartbeat = eventEnvelope("operation.heartbeat", {
      operationId: "operation-1",
      observedAt: 20_000,
      lastActivityAt: 15_000
    }, eventContext());

    expect(isEventEnvelope(heartbeat)).toBe(true);
  });

  it("rejects malformed timestamps and mismatched Operation authority", () => {
    const heartbeat = eventEnvelope("operation.heartbeat", {
      operationId: "operation-1",
      observedAt: 20_000,
      lastActivityAt: 15_000
    }, eventContext());

    expect(isEventEnvelope({
      ...heartbeat,
      payload: { ...heartbeat.payload, observedAt: -1 }
    })).toBe(false);
    expect(isEventEnvelope({
      ...heartbeat,
      payload: { ...heartbeat.payload, lastActivityAt: 20_001 }
    })).toBe(false);
    expect(isEventEnvelope({
      ...heartbeat,
      context: { ...heartbeat.context, operationId: "operation-2" }
    })).toBe(false);
    expect(isEventEnvelope({
      ...heartbeat,
      payload: { ...heartbeat.payload, extra: true }
    })).toBe(false);
  });
});

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
