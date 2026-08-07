import { describe, expect, it } from "vitest";
import {
  APP_PROTOCOL_CONTEXT,
  commandEnvelope,
  isResponseEnvelope,
  responseEnvelope
} from "./envelope.js";

describe("session name acknowledgement", () => {
  it("accepts only a narrow projection mutation acknowledgement", () => {
    const request = commandEnvelope(
      "session.name",
      { mutation: { action: "set", name: "Renamed" } },
      APP_PROTOCOL_CONTEXT,
      5,
      "rename-1"
    );
    const acknowledgement = responseEnvelope(request.requestId, 5, request.context, {
      ok: true,
      type: "session.name",
      result: {
        accepted: true,
        hostEpoch: 5,
        sessionId: "session-1",
        sessionFileIdentity: "session-file-1",
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
