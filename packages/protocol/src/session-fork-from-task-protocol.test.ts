import { describe, expect, it } from "vitest";
import { isReplaySafeControlMutation } from "./agent-messages.js";
import {
  APP_PROTOCOL_CONTEXT,
  COMMAND_CONTEXT_SCOPE_REQUIREMENTS,
  commandEnvelope,
  hasValidCommandContext,
  isRequestEnvelope,
  isResponseEnvelope,
  responseEnvelope,
  type ProtocolContext,
  type TaskProtocolContext
} from "./envelope.js";

const TARGET_TASK_CONTEXT: TaskProtocolContext = {
  scope: "task",
  workspaceId: "workspace-1",
  taskId: "task-target",
  taskGeneration: 1
};

const WORKSPACE_CONTEXT: ProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-1"
};

const PAYLOAD = {
  sourceTaskId: "task-source",
  sourceTaskGeneration: 4,
  sourceSessionId: "session-source",
  sourceSessionGeneration: 7,
  entryId: "assistant-entry-9"
} as const;

describe("session.forkFromTask protocol", () => {
  it("requires replay-safe target Task authority", () => {
    expect(isReplaySafeControlMutation("session.forkFromTask")).toBe(true);
    expect(COMMAND_CONTEXT_SCOPE_REQUIREMENTS["session.forkFromTask"]).toBe("task");
    expect(hasValidCommandContext("session.forkFromTask", TARGET_TASK_CONTEXT)).toBe(true);
    expect(hasValidCommandContext("session.forkFromTask", WORKSPACE_CONTEXT)).toBe(false);
    expect(hasValidCommandContext("session.forkFromTask", APP_PROTOCOL_CONTEXT)).toBe(false);

    const request = commandEnvelope(
      "session.forkFromTask",
      PAYLOAD,
      TARGET_TASK_CONTEXT,
      6,
      "continue-task-1"
    );
    expect(isRequestEnvelope(request)).toBe(true);
    const { idempotencyKey: _idempotencyKey, ...withoutKey } = request;
    expect(isRequestEnvelope(withoutKey)).toBe(false);
  });

  it("accepts only bounded source authority without a Session path", () => {
    const request = commandEnvelope(
      "session.forkFromTask",
      PAYLOAD,
      TARGET_TASK_CONTEXT,
      6,
      "continue-task-2"
    );

    for (const payload of [
      { ...PAYLOAD, sourceTaskId: "" },
      { ...PAYLOAD, sourceTaskGeneration: 0 },
      { ...PAYLOAD, sourceSessionGeneration: 0 },
      { ...PAYLOAD, entryId: "" },
      { ...PAYLOAD, sourcePath: "/private/source.jsonl" },
      { ...PAYLOAD, prompt: "must-not-cross" }
    ]) {
      expect(isRequestEnvelope({ ...request, payload })).toBe(false);
    }
  });

  it("returns only a projection acknowledgement under the target Task context", () => {
    const acknowledgement = {
      accepted: true as const,
      hostEpoch: 6,
      sessionId: "session-target",
      sessionGeneration: 2,
      eventSequence: 11
    };
    const response = responseEnvelope("continue-request-1", 6, TARGET_TASK_CONTEXT, {
      ok: true,
      type: "session.forkFromTask",
      result: acknowledgement
    });
    expect(isResponseEnvelope(response)).toBe(true);
    expect(isResponseEnvelope({
      ...response,
      result: { ...acknowledgement, sourceSessionId: "session-source" }
    })).toBe(false);
    expect(isResponseEnvelope({ ...response, context: WORKSPACE_CONTEXT })).toBe(false);
  });
});
