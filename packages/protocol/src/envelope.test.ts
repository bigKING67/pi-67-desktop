import { describe, expect, it } from "vitest";
import { MAX_TREE_NODES } from "@pi67/domain";
import {
  APP_PROTOCOL_CONTEXT,
  PROTOCOL_REVISION,
  PROTOCOL_VERSION,
  commandEnvelope,
  eventEnvelope,
  isRequestEnvelope,
  isEventEnvelope,
  isHostWelcome,
  isProtocolContext,
  isResponseEnvelope,
  responseEnvelope,
  welcomeEnvelope,
  type ProtocolContext
} from "./envelope.js";
import {
  appEventContext,
  emptyCatalog,
  emptySnapshot,
  taskContext,
  taskEventContext
} from "./envelope-test-fixtures.js";

const WORKSPACE_CONTEXT: ProtocolContext = { scope: "workspace", workspaceId: "workspace-1" };

describe("protocol v3 envelopes", () => {
  it("validates typed requests, events, responses and welcome", () => {
    const request = commandEnvelope("runtime.getStatus", {}, APP_PROTOCOL_CONTEXT, 7);
    const event = eventEnvelope("runtime.statusChanged", {
      phase: "ready",
      detail: "Pi SDK ready",
      recoverable: true
    }, appEventContext(7, 1));
    const response = responseEnvelope(request.requestId, 7, request.context, {
      ok: true,
      type: "runtime.getStatus",
      result: { initialized: true, loaded: true }
    });
    const welcome = welcomeEnvelope({
      appInstanceId: "app-1",
      hostInstanceId: "host-1",
      hostEpoch: 7,
      sdkVersion: "0.81.1",
      eventSequence: 0,
      capabilities: {
        operations: true,
        eventSequence: true,
        structuredErrors: true,
        transferableImages: true,
        transferableAssets: true,
        idempotentControlMutations: true
      },
      maxEnvelopeBytes: 2 * 1024 * 1024
    });

    expect(PROTOCOL_VERSION).toBe(3);
    expect(PROTOCOL_REVISION).toMatch(/^[0-9a-f]{64}$/u);
    expect(isRequestEnvelope(request)).toBe(true);
    expect(isEventEnvelope(event)).toBe(true);
    expect(isResponseEnvelope(response)).toBe(true);
    expect(isHostWelcome(welcome)).toBe(true);
  });

  it("rejects legacy protocol versions, missing event sequence and unknown payload fields", () => {
    expect(isRequestEnvelope({
      protocolVersion: 1,
      kind: "command",
      messageId: "m",
      requestId: "r",
      timestamp: Date.now(),
      command: { type: "runtime.getStatus", payload: {} }
    })).toBe(false);

    const v3Request = commandEnvelope("runtime.getStatus", {}, APP_PROTOCOL_CONTEXT, 1);
    expect(isRequestEnvelope({ ...v3Request, protocolVersion: 2 })).toBe(false);

    const event = eventEnvelope("runtime.statusChanged", {
      phase: "ready",
      detail: "ready",
      recoverable: true
    }, appEventContext(1, 1));
    const { sequence: _sequence, ...withoutSequence } = event;
    expect(isEventEnvelope(withoutSequence)).toBe(false);

    const request = commandEnvelope("session.import", {
      submissionId: "session-import-1",
      path: "/tmp/external.jsonl"
    }, APP_PROTOCOL_CONTEXT, 1);
    expect(isRequestEnvelope({ ...request, payload: { ...request.payload, cwdOverride: "/tmp/other" } })).toBe(false);
  });

  it("rejects a response whose result does not match the correlated command", () => {
    const malformed = {
      protocolVersion: 3,
      kind: "response",
      requestId: "r",
      hostEpoch: 1,
      context: APP_PROTOCOL_CONTEXT,
      type: "runtime.getStatus",
      ok: true,
      result: { initialized: "yes", loaded: true }
    };
    expect(isResponseEnvelope(malformed)).toBe(false);
  });

  it("validates error response payloads as strictly as success results", () => {
    const error = { code: "INTERNAL", message: "Runtime failed.", recoverable: true } as const;
    const valid = responseEnvelope("request-error", 1, APP_PROTOCOL_CONTEXT, {
      ok: false,
      type: "runtime.getStatus",
      error
    });

    expect(isResponseEnvelope(valid)).toBe(true);
    expect(isResponseEnvelope({
      ...valid,
      error: { ...error, credential: "must-not-cross-the-port" }
    })).toBe(false);
    expect(isResponseEnvelope({
      ...valid,
      error: { ...error, message: "x".repeat(4_097) }
    })).toBe(false);
  });

  it("requires the Host to declare whether an accepted operation is cancellable", () => {
    const request = commandEnvelope("session.import", {
      submissionId: "session-import-1",
      path: "/tmp/external.jsonl"
    }, taskContext(4), 3);
    const result = {
      kind: "accepted" as const,
      operationId: "operation-import",
      cancellable: false,
      hostEpoch: 3,
      sessionId: "session-1",
      sessionGeneration: 4
    };
    const response = responseEnvelope(request.requestId, 3, request.context, {
      ok: true,
      type: "session.import",
      result
    });

    expect(isResponseEnvelope(response)).toBe(true);
    const { cancellable: _cancellable, ...withoutCancellable } = result;
    expect(isResponseEnvelope({ ...response, result: withoutCancellable })).toBe(false);
  });

  it("validates the declared extension UI capability contract", () => {
    const ready = eventEnvelope("runtime.ready", {
      capabilities: {
        sdkVersion: "0.81.1",
        supportsFollowUp: true,
        supportsSessionTree: true,
        extensionUi: {
          primitives: ["select", "confirm", "input", "editor", "notify", "status", "text-widget", "title"],
          attribution: "none",
          recognizedCompatibilityLevels: ["native", "headless", "adapter", "partial", "tui-only", "unsupported"],
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
            widgetPlacements: ["aboveEditor", "belowEditor"]
          }
        }
      },
      snapshot: emptySnapshot(),
      taskToolMode: "auto"
    }, taskEventContext(1, 1, 1));
    expect(isEventEnvelope(ready)).toBe(true);
    expect(isEventEnvelope({
      ...ready,
      payload: {
        ...ready.payload,
        capabilities: { ...ready.payload.capabilities, supportsExtensionUi: true }
      }
    })).toBe(false);
  });

  it("keeps managed session open and external session import separate", () => {
    const managedOpen = commandEnvelope("session.open", {
      path: "/tmp/managed.jsonl",
      cwdOverride: "/tmp/workspace"
    }, taskContext(1), 1);
    const externalImport = commandEnvelope("session.import", {
      submissionId: "session-import-1",
      path: "/tmp/external.jsonl"
    }, taskContext(1), 1);
    expect(isRequestEnvelope(managedOpen)).toBe(true);
    expect(isRequestEnvelope(externalImport)).toBe(true);
  });

  it("validates the atomic queue clear contract", () => {
    const request = commandEnvelope("queue.clear", {}, taskContext(1), 1);
    const validResponse = responseEnvelope(request.requestId, 1, request.context, {
      ok: true,
      type: "queue.clear",
      result: { steeringCount: 1, followUpCount: 1, pendingCount: 2 }
    });
    expect(isRequestEnvelope(request)).toBe(true);
    expect(isRequestEnvelope({ ...request, payload: { index: 0 } })).toBe(false);
    expect(isResponseEnvelope(validResponse)).toBe(true);
    expect(isResponseEnvelope({
      ...validResponse,
      result: { steeringCount: 0, followUpCount: 0, pendingCount: -1 }
    })).toBe(false);
    expect(isResponseEnvelope({
      ...validResponse,
      result: { steeringCount: 0, followUpCount: 0 }
    })).toBe(false);
  });
  it("validates narrow session tree queries and extension response context", () => {
    const treeRequest = commandEnvelope("session.tree", {}, taskContext(1), 1);
    expect(isRequestEnvelope(treeRequest)).toBe(true);
    expect(isResponseEnvelope(responseEnvelope(treeRequest.requestId, 1, treeRequest.context, {
      ok: true,
      type: "session.tree",
      result: {
        nodes: [{
          id: "entry-1",
          parentId: null,
          type: "message",
          preview: "Tree entry",
          active: true,
          depth: 0
        }],
        truncated: false,
        total: 1
      }
    }))).toBe(true);
    expect(isResponseEnvelope(responseEnvelope(treeRequest.requestId, 1, treeRequest.context, {
      ok: true,
      type: "session.tree",
      result: [] as never
    }))).toBe(false);
    expect(isResponseEnvelope(responseEnvelope(treeRequest.requestId, 1, treeRequest.context, {
      ok: true,
      type: "session.tree",
      result: {
        nodes: Array.from({ length: MAX_TREE_NODES + 1 }, (_, index) => ({
          id: `entry-${index}`,
          parentId: null,
          type: "message",
          preview: "Tree entry",
          active: false,
          depth: 0
        })),
        truncated: true,
        total: MAX_TREE_NODES + 1
      }
    }))).toBe(false);

    const response = commandEnvelope("extension.ui.respond", {
      requestId: "extension-request-1",
      sessionId: "session-1",
      sessionGeneration: 3,
      operationId: "operation-1",
      value: "accepted"
    }, taskContext(3, "operation-1"), 1);
    expect(isRequestEnvelope(response)).toBe(true);
    expect(isRequestEnvelope({
      ...response,
      payload: { requestId: "extension-request-1", value: "accepted" }
    })).toBe(false);
  });

  it("validates independent Extension Catalog queries and change events", () => {
    const request = commandEnvelope("extension.catalog.list", {}, taskContext(4), 3);
    const catalog = emptyCatalog();
    expect(isRequestEnvelope(request)).toBe(true);
    expect(isResponseEnvelope(responseEnvelope(request.requestId, 3, request.context, {
      ok: true,
      type: "extension.catalog.list",
      result: catalog
    }))).toBe(true);
    const changed = eventEnvelope("extension.catalog.changed", catalog, {
      ...taskEventContext(3, 2, 4)
    });
    expect(isEventEnvelope(changed)).toBe(true);
    expect(isEventEnvelope({
      ...changed,
      payload: {
        ...catalog,
        items: [{ ...catalog.items[0], assessment: { ...catalog.items[0]!.assessment, overall: "perfect" } }]
      }
    })).toBe(false);
  });

  it("round-trips bounded Session Catalog pages and rejects response mutations", () => {
    const request = commandEnvelope("session.catalog.query", {
      scope: "workspace",
      search: "recovery",
      limit: 50
    }, WORKSPACE_CONTEXT, 3);
    const result = {
      items: [{
        id: "session-1",
        path: "/sessions/one.jsonl",
        cwd: "/workspace",
        name: "Recovery",
        nameSource: "explicit" as const,
        modifiedAt: 1_700_000_000_000,
        messageCount: 12
      }],
      total: 1,
      hasMore: false,
      revision: 4,
      itemCount: 8,
      source: "sqlite" as const,
      state: "ready" as const,
      rebuilding: false,
      reconciledAt: 1_700_000_000_000,
      incomplete: false,
      skippedCount: 0
    };
    const response = responseEnvelope(request.requestId, 3, request.context, {
      ok: true,
      type: "session.catalog.query",
      result
    });

    expect(isRequestEnvelope(request)).toBe(true);
    expect(isResponseEnvelope(response)).toBe(true);
    expect(isResponseEnvelope({
      ...response,
      result: { ...result, legacySessions: result.items }
    })).toBe(false);
  });

  it("uses dedicated bootstrap events for session identity transitions", () => {
    for (const reason of ["session-create", "session-open", "session-fork", "session-import"] as const) {
      expect(isEventEnvelope(eventEnvelope("session.bootstrap", {
        snapshot: emptySnapshot(),
        reason
      }, taskEventContext(1, 1, 1)))).toBe(true);
    }
    const bootstrap = eventEnvelope("session.bootstrap", {
      snapshot: emptySnapshot(),
      reason: "session-import"
    }, taskEventContext(1, 1, 1));
    expect(isEventEnvelope({
      ...bootstrap,
      payload: { ...bootstrap.payload, reason: "daily-update" }
    })).toBe(false);
  });

  it("bounds bootstrap transcripts and message page requests", () => {
    expect(isRequestEnvelope(commandEnvelope(
      "message.page",
      { direction: "older", limit: 200 },
      taskContext(1),
      1
    ))).toBe(true);
    expect(isRequestEnvelope({
      ...commandEnvelope("message.page", { direction: "older", limit: 200 }, taskContext(1), 1),
      payload: { direction: "older", limit: 201 }
    })).toBe(false);

    const oversized = {
      ...emptySnapshot(),
      messages: Array.from({ length: 101 }, (_, index) => ({
        id: `message-${index}`,
        role: "user" as const,
        parts: [{ type: "text" as const, text: "bounded" }]
      }))
    };
    const ready = eventEnvelope("runtime.ready", {
      capabilities: {
        sdkVersion: "0.81.1",
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
            widgetPlacements: ["aboveEditor", "belowEditor"]
          }
        }
      },
      snapshot: oversized,
      taskToolMode: "auto"
    }, taskEventContext(1, 1, 1));
    expect(isEventEnvelope(ready)).toBe(false);
  });

  it("strictly validates app, workspace and generation-bound task contexts", () => {
    expect(isProtocolContext(APP_PROTOCOL_CONTEXT)).toBe(true);
    expect(isProtocolContext(WORKSPACE_CONTEXT)).toBe(true);
    expect(isProtocolContext(taskContext(2, "operation-1"))).toBe(true);
    expect(isProtocolContext({ scope: "app", workspaceId: "workspace-1" })).toBe(false);
    expect(isProtocolContext({ scope: "workspace", workspaceId: "" })).toBe(false);
    expect(isProtocolContext({
      scope: "task",
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskGeneration: -1
    })).toBe(false);
    expect(isProtocolContext({
      scope: "task",
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskGeneration: 1,
      sessionId: "session-1"
    })).toBe(false);
    expect(isProtocolContext({
      scope: "task",
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskGeneration: 1,
      operationId: "operation-1"
    })).toBe(false);
  });

  it("requires a strict positive taskSequence only for task events", () => {
    const taskEvent = eventEnvelope("runtime.statusChanged", {
      phase: "ready",
      detail: "ready",
      recoverable: true
    }, taskEventContext(1, 1, 1));
    expect(isEventEnvelope(taskEvent)).toBe(true);
    const { taskSequence: _taskSequence, ...withoutTaskSequence } = taskEvent;
    expect(isEventEnvelope(withoutTaskSequence)).toBe(false);
    expect(isEventEnvelope({ ...taskEvent, taskSequence: 0 })).toBe(false);

    const appEvent = eventEnvelope("runtime.statusChanged", {
      phase: "ready",
      detail: "ready",
      recoverable: true
    }, appEventContext(1, 2));
    expect(isEventEnvelope(appEvent)).toBe(true);
    expect(isEventEnvelope({ ...appEvent, taskSequence: 1 })).toBe(false);
  });

});
