import { describe, expect, it } from "vitest";
import { commandEnvelope, isRequestEnvelope, isResponseEnvelope, responseEnvelope } from "./envelope.js";
import { isReplaySafeOperationAck } from "./replay-safe-commands.js";

const context = { scope: "task", workspaceId: "workspace", taskId: "task", taskGeneration: 1 } as const;
describe("Session recovery protocol", () => {
  it("accepts only bounded task-scoped identifiers and replay-safe continuation", () => {
    const request = commandEnvelope("session.recovery.continue", { submissionId: "recovery", anchor: "leaf-1" }, context, 1);
    expect(isRequestEnvelope(request)).toBe(true);
    expect(isReplaySafeOperationAck(request.type)).toBe(true);
    expect(isRequestEnvelope({ ...request, context: { scope: "app" } })).toBe(false);
    for (const anchor of ["", "a".repeat(129), "../session.jsonl"]) {
      expect(isRequestEnvelope({ ...request, payload: { ...request.payload, anchor } })).toBe(false);
    }
    expect(isRequestEnvelope({ ...request, payload: { ...request.payload, prompt: "untrusted prompt" } })).toBe(false);
  });
  it("keeps unknown outcomes distinct from available continuation", () => {
    const response = responseEnvelope("inspect", 1, context, { ok: true, type: "session.recovery.inspect", result: { status: "blocked", reason: "unconfirmed-tools", pendingToolCount: 1 } });
    expect(isResponseEnvelope(response)).toBe(true);
    expect(isResponseEnvelope({ ...response, result: { status: "available" } })).toBe(false);
    expect(isResponseEnvelope({ ...response, result: { status: "blocked", reason: "safe-to-retry", pendingToolCount: 0 } })).toBe(false);
  });
});
