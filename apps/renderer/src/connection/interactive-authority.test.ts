import type { OperationView, SessionSnapshot } from "@pi67/domain";
import { eventEnvelope } from "@pi67/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import {
  hasCurrentInteractiveAuthority,
  matchesInteractiveEnvelope,
  type InteractiveAuthority
} from "./interactive-authority.js";
import { taskEventFixture } from "./protocol-test-fixtures.js";

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
const request: InteractiveAuthority = {
  hostEpoch: 9,
  sessionId: "session-1",
  sessionGeneration: 3,
  operationId: "operation-1"
};
const state = {
  connected: true,
  hostEpoch: 9,
  operation
};
const envelope = eventEnvelope("resource.changed", { reason: "fixture" }, taskEventFixture({
  hostEpoch: 9,
  sequence: 1,
  sessionId: "session-1",
  sessionGeneration: 3,
  operationId: "operation-1"
}));

describe("interactive authority", () => {
  beforeEach(() => installSession(3));

  it("accepts only the active host, session generation, and operation", () => {
    const { sessionId: _sessionId, ...requestWithoutSession } = request;
    expect(hasCurrentInteractiveAuthority(state, request)).toBe(true);
    expect(hasCurrentInteractiveAuthority({ ...state, hostEpoch: 10 }, request)).toBe(false);
    installSession(4);
    expect(hasCurrentInteractiveAuthority(state, request)).toBe(false);
    installSession(3);
    expect(hasCurrentInteractiveAuthority({ ...state, operation: { ...operation, operationId: "operation-2" } }, request)).toBe(false);
    expect(hasCurrentInteractiveAuthority(state, requestWithoutSession)).toBe(false);
  });

  it("requires payload authority to match the wire envelope", () => {
    expect(matchesInteractiveEnvelope(request, envelope)).toBe(true);
    expect(matchesInteractiveEnvelope({ ...request, hostEpoch: 8 }, envelope)).toBe(false);
    expect(matchesInteractiveEnvelope({ ...request, sessionGeneration: 2 }, envelope)).toBe(false);
    expect(matchesInteractiveEnvelope({ ...request, operationId: "operation-old" }, envelope)).toBe(false);
  });

  it("supports session-scoped extension UI only when no operation is active", () => {
    const { operationId: _operationId, ...sessionRequest } = request;
    expect(hasCurrentInteractiveAuthority({ ...state, operation: undefined }, sessionRequest)).toBe(true);
    expect(hasCurrentInteractiveAuthority(state, sessionRequest)).toBe(false);
  });
});

function installSession(sessionGeneration: number): void {
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  installSessionProjectionFixture(state, snapshot(), sessionGeneration);
}

function snapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    sessionFileIdentity: "session-file-session-1",
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
