import { describe, expect, it } from "vitest";
import { Value } from "./typebox-schema.js";
import { CommandPayloadSchemas } from "./command-payload-schemas.js";
import { hasValidCommandContext } from "./protocol-context.js";
import { CommandResultSchemas } from "./schemas.js";

const file = {
  id: "file_ref_1",
  name: "main.ts",
  relativePath: "src/main.ts",
  kind: "file",
  revision: "revision_1",
  byteLength: 12,
  modifiedAt: 1
} as const;

describe("Inspector protocol", () => {
  it("validates strict Workspace file commands and bounded results", () => {
    expect(Value.Check(CommandPayloadSchemas["workspace.file.list"], {})).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["workspace.file.list"], { parentId: file.id, limit: 200 })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["workspace.file.list"], { limit: 201 })).toBe(false);
    expect(Value.Check(CommandPayloadSchemas["workspace.file.search"], { query: "main", includeGenerated: true })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["workspace.file.search"], { query: "x".repeat(257) })).toBe(false);
    expect(Value.Check(CommandPayloadSchemas["workspace.file.resolve"], { relativePath: file.relativePath })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["workspace.file.open"], { id: file.id })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["workspace.file.save"], {
      id: file.id,
      expectedRevision: file.revision,
      content: "export {};\n"
    })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["workspace.file.open"], { id: file.id, path: "/tmp/escape" })).toBe(false);

    expect(Value.Check(CommandResultSchemas["workspace.file.list"], {
      workspaceId: "workspace-1",
      entries: [file],
      truncated: false
    })).toBe(true);
    expect(Value.Check(CommandResultSchemas["workspace.file.open"], {
      id: file.id,
      relativePath: file.relativePath,
      kind: "text",
      totalBytes: 12,
      content: "export {};\n",
      revision: file.revision
    })).toBe(true);
  });

  it("requires Workspace authority for files and Task authority for message indexing", () => {
    const workspace = { scope: "workspace" as const, workspaceId: "workspace-1" };
    const task = {
      scope: "task" as const,
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskGeneration: 1,
      sessionId: "session-1",
      sessionGeneration: 1
    };
    expect(hasValidCommandContext("workspace.file.list", workspace)).toBe(true);
    expect(hasValidCommandContext("workspace.file.list", task)).toBe(false);
    expect(hasValidCommandContext("message.index", task)).toBe(true);
    expect(hasValidCommandContext("message.locate", workspace)).toBe(false);
  });

  it("validates user-only index pages and located conversation windows", () => {
    expect(Value.Check(CommandPayloadSchemas["message.index"], { limit: 200 })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["message.index"], { limit: 201 })).toBe(false);
    expect(Value.Check(CommandPayloadSchemas["message.locate"], { id: "message-1" })).toBe(true);
    expect(Value.Check(CommandResultSchemas["message.index"], {
      sessionId: "session-1",
      revision: 1,
      total: 1,
      offset: 0,
      items: [{
        id: "message-1",
        ordinal: 1,
        preview: "Inspect this file",
        createdAt: 1,
        imageCount: 0,
        attachmentCount: 1
      }]
    })).toBe(true);
    expect(Value.Check(CommandResultSchemas["message.locate"], {
      sessionId: "session-1",
      revision: 1,
      anchorId: "message-1",
      messages: [{
        id: "message-1",
        role: "user",
        parts: [{
          type: "attachment",
          id: "attachment_1",
          name: "brief.md",
          mimeType: "text/markdown",
          byteLength: 20,
          kind: "document"
        }]
      }],
      hasOlder: false,
      hasNewer: true,
      startCursor: "message-1",
      endCursor: "message-1"
    })).toBe(true);
  });
});
