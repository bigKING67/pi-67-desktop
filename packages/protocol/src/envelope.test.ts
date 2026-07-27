import { describe, expect, it } from "vitest";
import { MAX_TREE_NODES, type SessionSnapshot } from "@pi67/domain";
import {
  PROTOCOL_VERSION,
  commandEnvelope,
  eventEnvelope,
  isRequestEnvelope,
  isEventEnvelope,
  isHostWelcome,
  isResponseEnvelope,
  responseEnvelope,
  welcomeEnvelope
} from "./envelope.js";

describe("protocol v2 envelopes", () => {
  it("validates typed requests, events, responses and welcome", () => {
    const request = commandEnvelope("runtime.getStatus", {}, 7);
    const event = eventEnvelope("runtime.statusChanged", {
      phase: "ready",
      detail: "Pi SDK ready",
      recoverable: true
    }, { hostEpoch: 7, sequence: 1 });
    const response = responseEnvelope(request.requestId, 7, {
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

    expect(PROTOCOL_VERSION).toBe(2);
    expect(isRequestEnvelope(request)).toBe(true);
    expect(isEventEnvelope(event)).toBe(true);
    expect(isResponseEnvelope(response)).toBe(true);
    expect(isHostWelcome(welcome)).toBe(true);
  });

  it("rejects v1, missing event sequence and unknown payload fields", () => {
    expect(isRequestEnvelope({
      protocolVersion: 1,
      kind: "command",
      messageId: "m",
      requestId: "r",
      timestamp: Date.now(),
      command: { type: "runtime.getStatus", payload: {} }
    })).toBe(false);

    const event = eventEnvelope("runtime.statusChanged", {
      phase: "ready",
      detail: "ready",
      recoverable: true
    }, { hostEpoch: 1, sequence: 1, sessionId: "session-1", sessionGeneration: 1 });
    const { sequence: _sequence, ...withoutSequence } = event;
    expect(isEventEnvelope(withoutSequence)).toBe(false);

    const request = commandEnvelope("session.import", {
      submissionId: "session-import-1",
      path: "/tmp/external.jsonl"
    }, 1);
    expect(isRequestEnvelope({ ...request, payload: { ...request.payload, cwdOverride: "/tmp/other" } })).toBe(false);
  });

  it("rejects a response whose result does not match the correlated command", () => {
    const malformed = {
      protocolVersion: 2,
      kind: "response",
      requestId: "r",
      hostEpoch: 1,
      type: "runtime.getStatus",
      ok: true,
      result: { initialized: "yes", loaded: true }
    };
    expect(isResponseEnvelope(malformed)).toBe(false);
  });

  it("requires the Host to declare whether an accepted operation is cancellable", () => {
    const request = commandEnvelope("session.import", {
      submissionId: "session-import-1",
      path: "/tmp/external.jsonl"
    }, 3);
    const result = {
      kind: "accepted" as const,
      operationId: "operation-import",
      cancellable: false,
      hostEpoch: 3,
      sessionId: "session-1",
      sessionGeneration: 4
    };
    const response = responseEnvelope(request.requestId, 3, {
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
      snapshot: emptySnapshot()
    }, { hostEpoch: 1, sequence: 1, sessionId: "session-1", sessionGeneration: 1 });
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
    }, 1);
    const externalImport = commandEnvelope("session.import", {
      submissionId: "session-import-1",
      path: "/tmp/external.jsonl"
    }, 1);
    expect(isRequestEnvelope(managedOpen)).toBe(true);
    expect(isRequestEnvelope(externalImport)).toBe(true);
  });

  it("validates the atomic queue clear contract", () => {
    const request = commandEnvelope("queue.clear", {}, 1);
    const validResponse = responseEnvelope(request.requestId, 1, {
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
    const treeRequest = commandEnvelope("session.tree", {}, 1);
    expect(isRequestEnvelope(treeRequest)).toBe(true);
    expect(isResponseEnvelope(responseEnvelope(treeRequest.requestId, 1, {
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
    expect(isResponseEnvelope(responseEnvelope(treeRequest.requestId, 1, {
      ok: true,
      type: "session.tree",
      result: [] as never
    }))).toBe(false);
    expect(isResponseEnvelope(responseEnvelope(treeRequest.requestId, 1, {
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
    }, 1);
    expect(isRequestEnvelope(response)).toBe(true);
    expect(isRequestEnvelope({
      ...response,
      payload: { requestId: "extension-request-1", value: "accepted" }
    })).toBe(false);
  });

  it("validates independent Extension Catalog queries and change events", () => {
    const request = commandEnvelope("extension.catalog.list", {}, 3);
    const catalog = emptyCatalog();
    expect(isRequestEnvelope(request)).toBe(true);
    expect(isResponseEnvelope(responseEnvelope(request.requestId, 3, {
      ok: true,
      type: "extension.catalog.list",
      result: catalog
    }))).toBe(true);
    const changed = eventEnvelope("extension.catalog.changed", catalog, {
      hostEpoch: 3,
      sequence: 2,
      sessionId: "session-1",
      sessionGeneration: 4
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
    }, 3);
    const result = {
      items: [{
        id: "session-1",
        path: "/sessions/one.jsonl",
        cwd: "/workspace",
        name: "Recovery",
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
    const response = responseEnvelope(request.requestId, 3, {
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
      }, { hostEpoch: 1, sequence: 1, sessionId: "session-1", sessionGeneration: 1 }))).toBe(true);
    }
    const bootstrap = eventEnvelope("session.bootstrap", {
      snapshot: emptySnapshot(),
      reason: "session-import"
    }, { hostEpoch: 1, sequence: 1, sessionId: "session-1", sessionGeneration: 1 });
    expect(isEventEnvelope({
      ...bootstrap,
      payload: { ...bootstrap.payload, reason: "daily-update" }
    })).toBe(false);
  });

  it("bounds bootstrap transcripts and message page requests", () => {
    expect(isRequestEnvelope(commandEnvelope("message.page", { direction: "older", limit: 200 }, 1))).toBe(true);
    expect(isRequestEnvelope({
      ...commandEnvelope("message.page", { direction: "older", limit: 200 }, 1),
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
      snapshot: oversized
    }, { hostEpoch: 1, sequence: 1, sessionId: "session-1", sessionGeneration: 1 });
    expect(isEventEnvelope(ready)).toBe(false);
  });

});

function emptySnapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    cwd: "/tmp",
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

function emptyCatalog() {
  return {
    items: [{
      id: "/extensions/example.ts",
      label: "example-extension",
      path: "/extensions/example.ts",
      loadState: "loaded" as const,
      source: {
        path: "/extensions/example.ts",
        source: "example-extension",
        scope: "project" as const,
        origin: "top-level" as const
      },
      assessment: {
        overall: "partial" as const,
        detail: "Bounded catalog fixture.",
        surfaces: [
          { surface: "commands" as const, status: "supported" as const, detail: "One command." },
          { surface: "tools" as const, status: "not-present" as const, detail: "No tools." },
          { surface: "ui-primitives" as const, status: "unknown" as const, detail: "No attribution." },
          { surface: "tui-custom" as const, status: "unknown" as const, detail: "Unassessed." }
        ]
      },
      commandCount: 1,
      toolCount: 0
    }],
    total: 1,
    truncated: false
  };
}
