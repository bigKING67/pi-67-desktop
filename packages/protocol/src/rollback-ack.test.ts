import { describe, expect, it } from "vitest";
import {
  APP_PROTOCOL_CONTEXT,
  commandEnvelope,
  isResponseEnvelope,
  responseEnvelope
} from "./envelope.js";

describe("session rollback acknowledgement", () => {
  it("accepts a narrow projection mutation acknowledgement and rejects a full Snapshot", () => {
    const request = commandEnvelope(
      "session.rollback",
      { entryId: "entry-1" },
      APP_PROTOCOL_CONTEXT,
      5,
      "rollback-1"
    );
    const acknowledgement = responseEnvelope(request.requestId, 5, request.context, {
      ok: true,
      type: "session.rollback",
      result: {
        accepted: true,
        hostEpoch: 5,
        sessionId: "session-1",
        sessionGeneration: 3,
        eventSequence: 12
      }
    });

    expect(isResponseEnvelope(acknowledgement)).toBe(true);
    expect(isResponseEnvelope({
      ...acknowledgement,
      result: snapshot()
    })).toBe(false);
  });
});

function snapshot() {
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
