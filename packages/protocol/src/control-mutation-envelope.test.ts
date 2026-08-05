import { describe, expect, it } from "vitest";
import { APP_PROTOCOL_CONTEXT, commandEnvelope, isRequestEnvelope } from "./envelope.js";

describe("replay-safe control mutation envelopes", () => {
  it("requires bounded idempotency keys only for replay-safe control mutations", () => {
    const control = commandEnvelope(
      "session.create",
      { creationId: "session-creation-envelope" },
      APP_PROTOCOL_CONTEXT,
      3,
      "create-session-1"
    );
    expect(control.idempotencyKey).toBe("create-session-1");
    expect(isRequestEnvelope(control)).toBe(true);

    const { idempotencyKey: _idempotencyKey, ...withoutKey } = control;
    expect(isRequestEnvelope(withoutKey)).toBe(false);
    expect(isRequestEnvelope({ ...control, idempotencyKey: "x".repeat(513) })).toBe(false);

    const query = commandEnvelope("runtime.getStatus", {}, APP_PROTOCOL_CONTEXT, 3);
    expect(isRequestEnvelope({ ...query, idempotencyKey: "query-key" })).toBe(false);
  });
});
