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

const TASK_CONTEXT: TaskProtocolContext = {
  scope: "task",
  workspaceId: "workspace-1",
  taskId: "task-1",
  taskGeneration: 3
};
const WORKSPACE_CONTEXT: ProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-1"
};

describe("task.close protocol", () => {
  it("is a replay-safe Task-scoped control mutation", () => {
    expect(isReplaySafeControlMutation("task.close")).toBe(true);
    expect(COMMAND_CONTEXT_SCOPE_REQUIREMENTS["task.close"]).toBe("task");
    expect(hasValidCommandContext("task.close", TASK_CONTEXT)).toBe(true);
    expect(hasValidCommandContext("task.close", APP_PROTOCOL_CONTEXT)).toBe(false);
    expect(hasValidCommandContext("task.close", WORKSPACE_CONTEXT)).toBe(false);

    const request = commandEnvelope("task.close", { mode: "stop" }, TASK_CONTEXT, 4, "close-task-1");
    expect(request.idempotencyKey).toBe("close-task-1");
    expect(isRequestEnvelope(request)).toBe(true);
    const { idempotencyKey: _idempotencyKey, ...withoutKey } = request;
    expect(isRequestEnvelope(withoutKey)).toBe(false);

    expect(isRequestEnvelope(commandEnvelope(
      "task.close",
      { mode: "dispose" },
      APP_PROTOCOL_CONTEXT,
      4,
      "close-task-app"
    ))).toBe(false);
    expect(isRequestEnvelope(commandEnvelope(
      "task.close",
      { mode: "dispose" },
      WORKSPACE_CONTEXT,
      4,
      "close-task-workspace"
    ))).toBe(false);
  });

  it("accepts only stop or dispose without Prompt, path, or raw payload fields", () => {
    const request = commandEnvelope("task.close", { mode: "dispose" }, TASK_CONTEXT, 4, "close-task-2");
    expect(isRequestEnvelope(request)).toBe(true);

    for (const payload of [
      {},
      { mode: "background" },
      { mode: "stop", prompt: "do not persist this" },
      { mode: "stop", path: "/private/task.jsonl" },
      { mode: "dispose", raw: { secret: true } }
    ]) {
      expect(isRequestEnvelope({ ...request, payload })).toBe(false);
    }
  });

  it("validates a minimal close result under the same Task authority", () => {
    const response = responseEnvelope("close-request-1", 4, TASK_CONTEXT, {
      ok: true,
      type: "task.close",
      result: { closed: true, stopped: true }
    });
    expect(isResponseEnvelope(response)).toBe(true);

    expect(isResponseEnvelope({ ...response, result: { closed: false, stopped: true } })).toBe(false);
    expect(isResponseEnvelope({ ...response, result: { closed: true } })).toBe(false);
    expect(isResponseEnvelope({
      ...response,
      result: { closed: true, stopped: false, raw: "must-not-cross" }
    })).toBe(false);
    expect(isResponseEnvelope({ ...response, context: APP_PROTOCOL_CONTEXT })).toBe(false);
  });
});
