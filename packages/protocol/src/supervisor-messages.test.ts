import { describe, expect, it } from "vitest";
import {
  isAgentHostRuntimePoisonedMessage,
  isAgentHostShutdownCompleteMessage,
  isAgentHostShutdownRequest
} from "./supervisor-messages.js";

describe("Agent Host supervisor messages", () => {
  it("accepts only bounded structured abort watchdog failures", () => {
    const message = {
      type: "agent-host-runtime-poisoned",
      code: "ABORT_WATCHDOG_EXPIRED",
      operationId: "operation-1",
      abortTimeoutMs: 10_000
    };
    expect(isAgentHostRuntimePoisonedMessage(message)).toBe(true);
    expect(isAgentHostRuntimePoisonedMessage({ ...message, operationId: "" })).toBe(false);
    expect(isAgentHostRuntimePoisonedMessage({ ...message, abortTimeoutMs: 0 })).toBe(false);
    expect(isAgentHostRuntimePoisonedMessage({ ...message, debug: "raw runtime state" })).toBe(false);
  });

  it("accepts only exact Session import projection failures", () => {
    const message = {
      type: "agent-host-runtime-poisoned",
      code: "SESSION_IMPORT_PROJECTION_FAILED",
      operationId: "operation-import"
    };
    expect(isAgentHostRuntimePoisonedMessage(message)).toBe(true);
    expect(isAgentHostRuntimePoisonedMessage({ ...message, operationId: "" })).toBe(false);
    expect(isAgentHostRuntimePoisonedMessage({ ...message, error: "raw runtime failure" })).toBe(false);
  });

  it("accepts only exact Session writer lease failures", () => {
    const message = {
      type: "agent-host-runtime-poisoned",
      code: "SESSION_WRITER_LEASE_COMPROMISED"
    };
    expect(isAgentHostRuntimePoisonedMessage(message)).toBe(true);
    expect(isAgentHostRuntimePoisonedMessage({ ...message, path: "/private/session.jsonl" })).toBe(false);
  });

  it("accepts only exact bounded application shutdown requests", () => {
    const message = {
      type: "agent-host-shutdown",
      reason: "application-quit",
      deadlineMs: 4_000
    };
    expect(isAgentHostShutdownRequest(message)).toBe(true);
    expect(isAgentHostShutdownRequest({ ...message, deadlineMs: 99 })).toBe(false);
    expect(isAgentHostShutdownRequest({ ...message, deadlineMs: 10_001 })).toBe(false);
    expect(isAgentHostShutdownRequest({ ...message, reason: "restart" })).toBe(false);
    expect(isAgentHostShutdownRequest({ ...message, prompt: "must not cross the boundary" })).toBe(false);
  });

  it("accepts only bounded shutdown completion metadata", () => {
    const message = {
      type: "agent-host-shutdown-complete",
      activeOperation: "cancelled",
      queuedCommandsDropped: 2,
      extensionRequestsCancelled: 1
    };
    expect(isAgentHostShutdownCompleteMessage(message)).toBe(true);
    expect(isAgentHostShutdownCompleteMessage({ ...message, activeOperation: "completed" })).toBe(false);
    expect(isAgentHostShutdownCompleteMessage({ ...message, queuedCommandsDropped: -1 })).toBe(false);
    expect(isAgentHostShutdownCompleteMessage({ ...message, extensionRequestsCancelled: 10_001 })).toBe(false);
    expect(isAgentHostShutdownCompleteMessage({ ...message, rawToolPayload: "forbidden" })).toBe(false);
  });
});
