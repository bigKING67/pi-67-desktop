import { describe, expect, it } from "vitest";
import {
  commandEnvelope,
  eventEnvelope,
  isEventEnvelope,
  isRequestEnvelope,
  isResponseEnvelope,
  responseEnvelope
} from "./envelope.js";

describe("approval protocol schemas", () => {
  it("round-trips a fully authoritative approval request and response", () => {
    const approval = eventEnvelope("approval.requested", approvalPayload(), {
      hostEpoch: 4,
      sequence: 9,
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1"
    });
    const request = commandEnvelope("approval.respond", {
      requestId: "approval-1",
      toolCallId: "tool-call-1",
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1",
      allowed: true
    }, 4);
    const response = responseEnvelope(request.requestId, 4, {
      ok: true,
      type: "approval.respond",
      result: { resolved: true }
    });
    const resolved = eventEnvelope("approval.resolved", {
      requestId: "approval-1",
      toolCallId: "tool-call-1",
      allowed: true
    }, {
      hostEpoch: 4,
      sequence: 10,
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1"
    });
    const cancelled = eventEnvelope("approval.cancelled", {
      requests: [{ requestId: "approval-1", toolCallId: "tool-call-1" }],
      reason: "abort"
    }, {
      hostEpoch: 4,
      sequence: 11,
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1"
    });

    expect(isEventEnvelope(approval)).toBe(true);
    expect(isEventEnvelope(resolved)).toBe(true);
    expect(isEventEnvelope(cancelled)).toBe(true);
    expect(isRequestEnvelope(request)).toBe(true);
    expect(isResponseEnvelope(response)).toBe(true);
  });

  it("rejects missing authority, invalid scope and unknown approval fields", () => {
    const event = eventEnvelope("approval.requested", approvalPayload(), {
      hostEpoch: 4,
      sequence: 9,
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1"
    });
    const { operationId: _operationId, ...withoutOperation } = event.payload;
    expect(isEventEnvelope({ ...event, payload: withoutOperation })).toBe(false);
    expect(isEventEnvelope({
      ...event,
      payload: { ...event.payload, scope: "session" }
    })).toBe(false);
    expect(isEventEnvelope({
      ...event,
      payload: { ...event.payload, rawToolInput: { command: "git push" } }
    })).toBe(false);

    const request = commandEnvelope("approval.respond", {
      requestId: "approval-1",
      toolCallId: "tool-call-1",
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1",
      allowed: true
    }, 4);
    const { operationId: _responseOperationId, ...withoutResponseOperation } = request.payload;
    expect(isRequestEnvelope({ ...request, payload: withoutResponseOperation })).toBe(false);
    expect(isRequestEnvelope({
      ...request,
      payload: { ...request.payload, toolCallId: "" }
    })).toBe(false);
    const resolved = eventEnvelope("approval.resolved", {
      requestId: "approval-1",
      toolCallId: "tool-call-1",
      allowed: true
    }, {
      hostEpoch: 4,
      sequence: 10,
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1"
    });
    const { toolCallId: _resolvedToolCallId, ...resolvedWithoutTool } = resolved.payload;
    expect(isEventEnvelope({ ...resolved, payload: resolvedWithoutTool })).toBe(false);
    const cancelled = eventEnvelope("approval.cancelled", {
      requests: [{ requestId: "approval-1", toolCallId: "tool-call-1" }],
      reason: "abort"
    }, {
      hostEpoch: 4,
      sequence: 11,
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1"
    });
    expect(isEventEnvelope({
      ...cancelled,
      payload: { ...cancelled.payload, requests: [{ requestId: "approval-1", toolCallId: "" }] }
    })).toBe(false);
  });
});

describe("workspace change protocol schemas", () => {
  it("keeps edit and write projections as strict discriminated unions", () => {
    const editChange = {
      kind: "edit" as const,
      toolCallId: "edit-1",
      path: "src/index.ts",
      pathTruncated: false,
      status: "completed" as const,
      patch: "@@ -1 +1 @@\n-old\n+new",
      patchTruncated: false,
      additions: 1,
      deletions: 1,
      firstChangedLine: 1
    };
    const edit = eventEnvelope("workspace.changeChanged", {
      sessionId: "session-1",
      change: editChange
    }, { hostEpoch: 1, sequence: 1, sessionId: "session-1", sessionGeneration: 1 });
    const writeChange = {
      kind: "write" as const,
      toolCallId: "write-1",
      path: "src/new.ts",
      pathTruncated: false,
      status: "completed" as const,
      writtenBytes: 67,
      writtenLines: 3,
      metricsTruncated: false
    };
    const write = eventEnvelope("workspace.changeChanged", {
      sessionId: "session-1",
      change: writeChange
    }, { hostEpoch: 1, sequence: 2, sessionId: "session-1", sessionGeneration: 1 });

    expect(isEventEnvelope(edit)).toBe(true);
    expect(isEventEnvelope(write)).toBe(true);
    expect(isEventEnvelope({
      ...edit,
      payload: { ...edit.payload, change: { ...edit.payload.change, metricsTruncated: false } }
    })).toBe(false);
    const { patchTruncated: _patchTruncated, ...editWithoutPatchState } = editChange;
    expect(isEventEnvelope({
      ...edit,
      payload: { ...edit.payload, change: editWithoutPatchState }
    })).toBe(false);
    expect(isEventEnvelope({
      ...write,
      payload: { ...write.payload, change: { ...write.payload.change, patch: "fake diff" } }
    })).toBe(false);
    const { metricsTruncated: _metricsTruncated, ...writeWithoutMetricsState } = writeChange;
    expect(isEventEnvelope({
      ...write,
      payload: { ...write.payload, change: writeWithoutMetricsState }
    })).toBe(false);
  });

  it("requires authoritative changes in projection resync results", () => {
    const request = commandEnvelope("projection.resync", {}, 2);
    const response = responseEnvelope(request.requestId, 2, {
      ok: true,
      type: "projection.resync",
      result: {
        snapshot: emptySnapshot(),
        changes: { sessionId: "session-1", items: [], truncated: false, total: 0 },
        extensionCatalog: { items: [], total: 0, truncated: false },
        sessionCatalogStatus: {
          revision: 1,
          itemCount: 0,
          source: "sqlite",
          state: "ready",
          rebuilding: false,
          incomplete: false,
          skippedCount: 0
        },
        eventSequence: 12,
        hostEpoch: 2,
        sessionGeneration: 4
      }
    });
    expect(isResponseEnvelope(response)).toBe(true);
    if (!response.ok) throw new Error("Expected a projection resync success response.");
    const { changes: _changes, ...withoutChanges } = response.result;
    expect(isResponseEnvelope({ ...response, result: withoutChanges })).toBe(false);
  });
});

function approvalPayload() {
  return {
    requestId: "approval-1",
    sessionId: "session-1",
    sessionGeneration: 3,
    operationId: "operation-1",
    hostEpoch: 4,
    toolCallId: "tool-call-1",
    toolName: "bash",
    category: "git-external-action" as const,
    reason: "访问或修改远程 Git 状态",
    targetKind: "command" as const,
    target: "git push origin main",
    targetTruncated: false,
    cwd: "/workspace",
    cwdTruncated: false,
    scope: "single-tool-call" as const
  };
}

function emptySnapshot() {
  return {
    sessionId: "session-1",
    cwd: "/workspace",
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
