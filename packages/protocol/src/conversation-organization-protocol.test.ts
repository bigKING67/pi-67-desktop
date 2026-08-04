import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { isReplaySafeControlMutation } from "./agent-messages.js";
import { CommandPayloadSchemas } from "./command-payload-schemas.js";
import { commandEnvelope, isRequestEnvelope } from "./envelope.js";
import {
  COMMAND_CONTEXT_SCOPE_REQUIREMENTS,
  hasValidCommandContext
} from "./protocol-context.js";

describe("conversation organization protocol", () => {
  it("uses replay-safe Workspace mutations with bounded payloads", () => {
    for (const type of ["session.nameByPath", "conversation.pin", "conversation.archive"] as const) {
      expect(isReplaySafeControlMutation(type)).toBe(true);
      expect(COMMAND_CONTEXT_SCOPE_REQUIREMENTS[type]).toBe("workspace");
      expect(hasValidCommandContext(type, { scope: "workspace", workspaceId: "workspace-a" })).toBe(true);
      expect(hasValidCommandContext(type, { scope: "app" })).toBe(false);
    }
    expect(Value.Check(CommandPayloadSchemas["session.nameByPath"], {
      path: "/sessions/one.jsonl",
      mutation: { action: "clear" }
    })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["session.nameByPath"], {
      path: "/sessions/one.jsonl",
      mutation: { action: "set", name: "" }
    })).toBe(false);
    expect(isRequestEnvelope(commandEnvelope(
      "conversation.archive",
      { path: "/sessions/one.jsonl", archived: true },
      { scope: "workspace", workspaceId: "workspace-a" },
      1,
      "archive-one"
    ))).toBe(true);
  });
});
