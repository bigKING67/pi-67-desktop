import { describe, expect, it } from "vitest";
import { Value } from "./typebox-schema.js";
import { CommandPayloadSchemas } from "./command-payload-schemas.js";
import { EventPayloadSchemas, CommandResultSchemas } from "./schemas.js";
import { hasValidCommandContext } from "./protocol-context.js";

const view = {
  runId: "run-1",
  childId: "child-1",
  activationId: "activation-1",
  depth: 1,
  role: "explorer",
  state: "running",
  mode: "background",
  context: "fresh",
  isolation: "shared",
  updatedAt: 1
} as const;

describe("native subagent protocol", () => {
  it("validates task-scoped controls and rejects Browser Profile fields", () => {
    expect(Value.Check(CommandPayloadSchemas["subagent.wait"], {
      ids: ["run-1"],
      mode: "all",
      timeoutMs: 30_000
    })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["subagent.resume"], {
      id: "run-1",
      profile: "Default"
    })).toBe(false);
    expect(Value.Check(CommandPayloadSchemas["subagent.resume"], {
      id: "run-1",
      browser_instance_id: "browser-a"
    })).toBe(false);
    expect(hasValidCommandContext("subagent.list", {
      scope: "task",
      workspaceId: "workspace",
      taskId: "task",
      taskGeneration: 1
    })).toBe(true);
    expect(hasValidCommandContext("subagent.list", {
      scope: "workspace",
      workspaceId: "workspace"
    })).toBe(false);
  });

  it("validates roster results and lifecycle events", () => {
    expect(Value.Check(CommandResultSchemas["subagent.list"], { items: [view] })).toBe(true);
    expect(Value.Check(CommandResultSchemas["subagent.wait"], {
      items: [{ ...view, state: "completed", settledAt: 2, result: "done" }],
      timedOut: false
    })).toBe(true);
    expect(Value.Check(EventPayloadSchemas["subagent.changed"], {
      item: view,
      reason: "started"
    })).toBe(true);
  });
});
