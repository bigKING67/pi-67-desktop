import { describe, expect, it } from "vitest";
import { isReplaySafeControlMutation } from "./agent-messages.js";
import {
  APP_PROTOCOL_CONTEXT,
  COMMAND_CONTEXT_SCOPE_REQUIREMENTS,
  commandEnvelope,
  correlateInvalidRequest,
  hasValidCommandContext,
  isRequestEnvelope,
  isResponseEnvelope,
  responseEnvelope,
  type TaskProtocolContext,
  type WorkspaceProtocolContext
} from "./envelope.js";

const WORKSPACE_CONTEXT: WorkspaceProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-1"
};
const TASK_CONTEXT: TaskProtocolContext = {
  scope: "task",
  workspaceId: "workspace-1",
  taskId: "task-1",
  taskGeneration: 1
};

describe("Workspace registration protocol", () => {
  it("uses replay-safe Workspace authority and keeps the technical identity in context", () => {
    for (const type of ["workspace.register", "workspace.unregister"] as const) {
      expect(isReplaySafeControlMutation(type)).toBe(true);
      expect(COMMAND_CONTEXT_SCOPE_REQUIREMENTS[type]).toBe("workspace");
      expect(hasValidCommandContext(type, WORKSPACE_CONTEXT)).toBe(true);
      expect(hasValidCommandContext(type, APP_PROTOCOL_CONTEXT)).toBe(false);
      expect(hasValidCommandContext(type, TASK_CONTEXT)).toBe(false);
    }

    const request = commandEnvelope("workspace.register", {
      cwd: "/workspace",
      trust: "trusted",
      approvalMode: "guided"
    }, WORKSPACE_CONTEXT, 4, "register-workspace-1");
    expect(isRequestEnvelope(request)).toBe(true);
    expect(correlateInvalidRequest(request)).toEqual({
      requestId: request.requestId,
      hostEpoch: 4,
      type: "workspace.register",
      context: WORKSPACE_CONTEXT
    });
    expect("workspaceId" in request.payload).toBe(false);

    const { idempotencyKey: _idempotencyKey, ...withoutKey } = request;
    expect(isRequestEnvelope(withoutKey)).toBe(false);
    expect(isRequestEnvelope({ ...request, context: APP_PROTOCOL_CONTEXT })).toBe(false);
    expect(isRequestEnvelope({ ...request, context: TASK_CONTEXT })).toBe(false);
  });

  it("keeps register and unregister payloads strict and bounded", () => {
    const register = commandEnvelope("workspace.register", {
      cwd: "/workspace",
      trust: "unknown",
      approvalMode: "balanced"
    }, WORKSPACE_CONTEXT, 4, "register-workspace-2");
    for (const payload of [
      {},
      { cwd: "", trust: "trusted", approvalMode: "guided" },
      { cwd: "/workspace", trust: "implicit", approvalMode: "guided" },
      { cwd: "/workspace", trust: "trusted", approvalMode: "always" },
      { cwd: "/workspace", trust: "trusted", approvalMode: "guided", workspaceId: "shadow" }
    ]) {
      expect(isRequestEnvelope({ ...register, payload })).toBe(false);
    }

    const unregister = commandEnvelope(
      "workspace.unregister",
      {},
      WORKSPACE_CONTEXT,
      4,
      "unregister-workspace-1"
    );
    expect(isRequestEnvelope(unregister)).toBe(true);
    expect(isRequestEnvelope({ ...unregister, payload: { force: true } })).toBe(false);
  });

  it("echoes Workspace authority in minimal registration responses", () => {
    const responses = [
      responseEnvelope("response-workspace.register", 4, WORKSPACE_CONTEXT, {
        ok: true,
        type: "workspace.register",
        result: { registered: true }
      }),
      responseEnvelope("response-workspace.unregister", 4, WORKSPACE_CONTEXT, {
        ok: true,
        type: "workspace.unregister",
        result: { unregistered: true }
      })
    ];

    for (const response of responses) {
      expect(isResponseEnvelope(response)).toBe(true);
      expect(response.context).toEqual(WORKSPACE_CONTEXT);
      expect(isResponseEnvelope({ ...response, context: APP_PROTOCOL_CONTEXT })).toBe(false);
      if (!response.ok) throw new Error("Expected a Workspace registration success response.");
      expect(isResponseEnvelope({
        ...response,
        result: { ...response.result, workspaceId: "shadow" }
      })).toBe(false);
    }
  });
});
