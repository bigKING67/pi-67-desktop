import { describe, expect, it } from "vitest";
import {
  APP_PROTOCOL_CONTEXT,
  commandEnvelope,
  isRequestEnvelope,
  isResponseEnvelope,
  responseEnvelope
} from "./envelope.js";

describe("Session bootstrap acknowledgements", () => {
  it.each([
    ["runtime.initialize", {
      cwd: "/workspace",
      trust: "unknown" as const,
      approvalMode: "guided" as const
    }],
    ["workspace.open", {
      cwd: "/workspace",
      trust: "unknown" as const,
      approvalMode: "guided" as const
    }],
    ["session.create", { creationId: "session-creation-bootstrap" }],
    ["session.open", { path: "/sessions/session-2.jsonl" }],
    ["session.fork", { entryId: "entry-2" }]
  ] as const)("validates a narrow %s response", (type, payload) => {
    const request = commandEnvelope(type, payload, APP_PROTOCOL_CONTEXT, 5, `${type}-1`);
    const acknowledgement = responseEnvelope(request.requestId, 5, request.context, {
      ok: true,
      type,
      result: projectionAcknowledgement()
    });

    expect(isResponseEnvelope(acknowledgement)).toBe(true);
    expect(isResponseEnvelope({
      ...acknowledgement,
      result: snapshot()
    })).toBe(false);
    expect(isResponseEnvelope({
      ...acknowledgement,
      result: acknowledgementWithoutHostEpoch()
    })).toBe(false);
    expect(isResponseEnvelope({
      ...acknowledgement,
      result: { ...projectionAcknowledgement(), messages: [] }
    })).toBe(false);
  });

  it("accepts only the supported Session fork positions", () => {
    const before = commandEnvelope("session.fork", {
      entryId: "entry-2",
      position: "before"
    }, APP_PROTOCOL_CONTEXT, 5);
    const at = commandEnvelope("session.fork", {
      entryId: "entry-2",
      position: "at"
    }, APP_PROTOCOL_CONTEXT, 5);

    expect(isRequestEnvelope(before)).toBe(true);
    expect(isRequestEnvelope(at)).toBe(true);
    expect(isRequestEnvelope({
      ...at,
      payload: { entryId: "entry-2", position: "after" }
    })).toBe(false);
  });
});

function projectionAcknowledgement() {
  return {
    accepted: true as const,
    hostEpoch: 5,
    sessionId: "session-2",
    sessionGeneration: 4,
    eventSequence: 12
  };
}

function acknowledgementWithoutHostEpoch() {
  const { hostEpoch: _hostEpoch, ...acknowledgement } = projectionAcknowledgement();
  return acknowledgement;
}

function snapshot() {
  return {
    sessionId: "session-2",
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
