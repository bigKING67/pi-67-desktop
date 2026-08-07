import { describe, expect, it } from "vitest";
import {
  APP_PROTOCOL_CONTEXT,
  COMMAND_CONTEXT_SCOPE_REQUIREMENTS,
  commandEnvelope,
  isRequestEnvelope,
  isResponseEnvelope,
  responseEnvelope,
  type ProtocolContext
} from "./envelope.js";

const WORKSPACE_CONTEXT: ProtocolContext = {
  scope: "workspace",
  workspaceId: "workspace-1"
};

describe("Session creation identity protocol", () => {
  it("requires a bounded creation id for create and resolve", () => {
    const create = commandEnvelope(
      "session.create",
      { creationId: "session-creation-1" },
      {
        scope: "task",
        workspaceId: "workspace-1",
        taskId: "task-1",
        taskGeneration: 1
      },
      2,
      "create-session-1"
    );
    expect(isRequestEnvelope(create)).toBe(true);
    for (const payload of [
      {},
      { creationId: "" },
      { creationId: "contains spaces" },
      { creationId: "x".repeat(129) },
      { creationId: "valid", prompt: "must-not-cross" }
    ]) {
      expect(isRequestEnvelope({ ...create, payload })).toBe(false);
    }

    const resolve = commandEnvelope(
      "session.creation.resolve",
      { creationId: "session-creation-1" },
      WORKSPACE_CONTEXT,
      2
    );
    expect(COMMAND_CONTEXT_SCOPE_REQUIREMENTS["session.creation.resolve"]).toBe("workspace");
    expect(isRequestEnvelope(resolve)).toBe(true);
    expect(isRequestEnvelope({ ...resolve, context: APP_PROTOCOL_CONTEXT })).toBe(false);
  });

  it("accepts only exact materialized, missing, ambiguous, or unavailable results", () => {
    const materialized = responseEnvelope("request-1", 2, WORKSPACE_CONTEXT, {
      ok: true,
      type: "session.creation.resolve",
      result: {
        status: "materialized",
        creationId: "session-creation-1",
        sessionId: "session-1",
        sessionFileIdentity: "session-file-fixture-1",
        sessionPath: "/sessions/session-1.jsonl"
      }
    });
    expect(isResponseEnvelope(materialized)).toBe(true);
    if (!materialized.ok) throw new Error("Expected a Session creation resolution success response.");
    expect(isResponseEnvelope({
      ...materialized,
      result: { ...materialized.result, prompt: "must-not-cross" }
    })).toBe(false);

    for (const status of ["missing", "ambiguous"] as const) {
      expect(isResponseEnvelope(responseEnvelope(`request-${status}`, 2, WORKSPACE_CONTEXT, {
        ok: true,
        type: "session.creation.resolve",
        result: { status, creationId: "session-creation-1" }
      }))).toBe(true);
    }
    expect(isResponseEnvelope(responseEnvelope("request-unavailable", 2, WORKSPACE_CONTEXT, {
      ok: true,
      type: "session.creation.resolve",
      result: {
        status: "unavailable",
        creationId: "session-creation-1",
        reason: "scan-limit"
      }
    }))).toBe(true);
  });
});
