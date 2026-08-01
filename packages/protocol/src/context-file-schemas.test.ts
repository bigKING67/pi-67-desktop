import { describe, expect, it } from "vitest";
import { Value } from "./typebox-schema.js";
import { CommandPayloadSchemas } from "./command-payload-schemas.js";
import { hasValidCommandContext } from "./protocol-context.js";
import { CommandResultSchemas } from "./schemas.js";

const id = `ctx_${"a".repeat(64)}`;
const revision = "b".repeat(64);
const item = {
  id,
  name: "AGENTS.md",
  path: "/workspace/AGENTS.md",
  category: "rules-context",
  scope: "project",
  origin: "workspace",
  presence: "present",
  access: "editable",
  runtimeState: "active"
} as const;

describe("context file protocol", () => {
  it("accepts strict list, read, and save payloads", () => {
    expect(Value.Check(CommandPayloadSchemas["context.file.list"], {})).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["context.file.read"], { id })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["context.file.save"], {
      id,
      expectedRevision: revision,
      content: "# Rules\n"
    })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["context.file.save"], {
      id,
      expectedRevision: revision,
      content: "# Rules\n",
      path: "/tmp/escape.md"
    })).toBe(false);
    expect(Value.Check(CommandPayloadSchemas["context.file.save"], {
      id,
      expectedRevision: revision,
      content: "x".repeat(1_000_001)
    })).toBe(false);
  });

  it("requires Workspace authority", () => {
    expect(hasValidCommandContext("context.file.list", {
      scope: "workspace",
      workspaceId: "workspace-1"
    })).toBe(true);
    expect(hasValidCommandContext("context.file.read", { scope: "app" })).toBe(false);
    expect(hasValidCommandContext("context.file.save", {
      scope: "task",
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskGeneration: 1
    })).toBe(false);
  });

  it("validates catalog, read, and save results without accepting extra fields", () => {
    const catalog = { items: [item], workspaceTrusted: true };
    expect(Value.Check(CommandResultSchemas["context.file.list"], catalog)).toBe(true);
    expect(Value.Check(CommandResultSchemas["context.file.read"], {
      item,
      content: "# Rules\n",
      revision
    })).toBe(true);
    expect(Value.Check(CommandResultSchemas["context.file.save"], {
      item,
      revision,
      files: catalog
    })).toBe(true);
    expect(Value.Check(CommandResultSchemas["context.file.save"], {
      item,
      revision,
      files: catalog,
      content: "must not be returned"
    })).toBe(false);
  });
});
