import { describe, expect, it } from "vitest";
import { eventEnvelope, isEventEnvelope } from "./envelope.js";

describe("external Session change protocol", () => {
  it("keeps the event path-free and reason-typed", () => {
    const event = eventEnvelope("session.externalChangeDetected", {
      reason: "appended",
      recoverable: true
    }, {
      hostEpoch: 1,
      sequence: 2,
      context: {
        scope: "task",
        workspaceId: "workspace-1",
        taskId: "task-1",
        taskGeneration: 1,
        sessionId: "session-1",
        sessionFileIdentity: "session-file-1",
        sessionGeneration: 3
      },
      taskSequence: 1
    });

    expect(isEventEnvelope(event)).toBe(true);
    expect(isEventEnvelope({
      ...event,
      payload: { path: "/private/session.jsonl" }
    })).toBe(false);
    expect(isEventEnvelope({
      ...event,
      payload: { reason: "modified", recoverable: true }
    })).toBe(false);
  });
});
