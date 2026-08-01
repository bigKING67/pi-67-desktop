import { describe, expect, it } from "vitest";
import { eventEnvelope, isEventEnvelope } from "./envelope.js";

describe("operation activity protocol", () => {
  it("accepts responding activity and explicit activity clearing", () => {
    const responding = eventEnvelope("operation.activityChanged", {
      operationId: "operation-1",
      activity: { kind: "responding" }
    }, eventContext());
    const cleared = eventEnvelope("operation.activityChanged", {
      operationId: "operation-1",
      activity: null
    }, eventContext());

    expect(isEventEnvelope(responding)).toBe(true);
    expect(isEventEnvelope(cleared)).toBe(true);
  });

  it("rejects unknown activity fields and malformed clear values", () => {
    const valid = eventEnvelope("operation.activityChanged", {
      operationId: "operation-1",
      activity: { kind: "responding" }
    }, eventContext());

    expect(isEventEnvelope({
      ...valid,
      payload: { ...valid.payload, activity: { kind: "responding", detail: "unvalidated" } }
    })).toBe(false);
    expect(isEventEnvelope({
      ...valid,
      payload: { ...valid.payload, activity: undefined }
    })).toBe(false);
  });

  it("accepts bounded tool identity and outcome without raw arguments or results", () => {
    const tool = eventEnvelope("operation.activityChanged", {
      operationId: "operation-1",
      activity: {
        kind: "tool",
        toolCallId: "tool-1",
        toolName: "WebSearch",
        toolKind: "search",
        status: "failed",
        aliasTarget: "web_search",
        authorization: { mode: "auto", reason: "read-only" }
      }
    }, eventContext());

    expect(isEventEnvelope(tool)).toBe(true);
    expect(isEventEnvelope({
      ...tool,
      payload: {
        ...tool.payload,
        activity: { ...tool.payload.activity, authorization: { mode: "auto", reason: "unknown" } }
      }
    })).toBe(false);
    expect(isEventEnvelope({
      ...tool,
      payload: {
        ...tool.payload,
        activity: { ...tool.payload.activity, rawResult: "must not cross protocol" }
      }
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
      sessionGeneration: 2,
      operationId: "operation-1"
    },
    taskSequence: 1
  };
}
