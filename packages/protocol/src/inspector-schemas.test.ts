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
    expect(Value.Check(CommandPayloadSchemas["workspace.file.list"], {
      parentId: file.id,
      limit: 200,
      includeGenerated: true
    })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["workspace.file.list"], { limit: 201 })).toBe(false);
    expect(Value.Check(CommandPayloadSchemas["workspace.file.search"], { query: "main", includeGenerated: true })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["workspace.file.search"], { query: "x".repeat(257) })).toBe(false);
    expect(Value.Check(CommandPayloadSchemas["workspace.file.contentSearch"], {
      query: "answer",
      includeGenerated: false,
      caseSensitive: true
    })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["workspace.file.contentSearch"], {
      query: "answer",
      absolutePath: "/tmp/escape"
    })).toBe(false);
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
    expect(Value.Check(CommandResultSchemas["workspace.file.contentSearch"], {
      workspaceId: "workspace-1",
      query: "answer",
      matches: [{
        entry: file,
        line: 3,
        column: 8,
        snippet: "const answer = 42;",
        snippetTruncated: false
      }],
      filesVisited: 1,
      bytesVisited: 19,
      skippedCount: 0,
      truncated: false,
      incomplete: false
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
      sessionFileIdentity: "session-file-1",
      sessionGeneration: 1
    };
    expect(hasValidCommandContext("workspace.file.list", workspace)).toBe(true);
    expect(hasValidCommandContext("workspace.file.list", task)).toBe(false);
    expect(hasValidCommandContext("message.index", task)).toBe(true);
    expect(hasValidCommandContext("message.search", task)).toBe(true);
    expect(hasValidCommandContext("session.catalog.contentSearch", workspace)).toBe(true);
    expect(hasValidCommandContext("message.locate", workspace)).toBe(false);
  });

  it("validates bounded current and Workspace message search projections", () => {
    expect(Value.Check(CommandPayloadSchemas["message.search"], { query: "release marker" })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["message.search"], { query: "" })).toBe(false);
    expect(Value.Check(CommandResultSchemas["message.search"], {
      sessionId: "session-1",
      revision: 2,
      query: "release marker",
      total: 1,
      items: [{ id: "message-1", role: "assistant", snippet: "release marker" }],
      truncated: false
    })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["session.catalog.contentSearch"], { query: "release" })).toBe(true);
    expect(Value.Check(CommandResultSchemas["session.catalog.contentSearch"], {
      workspaceId: "workspace-1",
      query: "release",
      items: [{
        sessionFileIdentity: "session-file-1",
        sessionPath: "/sessions/one.jsonl",
        sessionName: "Release work",
        messageId: "message-1",
        role: "user",
        snippet: "release"
      }],
      sessionsVisited: 1,
      entriesVisited: 2,
      skippedCount: 0,
      incomplete: false,
      truncated: false
    })).toBe(true);
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

  it("validates exact Workspace usage aggregates without billing or reasoning fields", () => {
    const report = {
      workspaceId: "workspace-1",
      generatedAt: 1,
      window: "30d",
      buckets: [{
        date: "2026-08-09",
        provider: "groland",
        model: "gpt-5.5",
        source: "assistant-message",
        sessions: 1,
        turns: 2,
        totals: { input: 10, output: 2, cacheRead: 3, cacheWrite: 0, total: 15, recordedCost: 0.1 }
      }],
      models: [{
        provider: "groland",
        model: "gpt-5.5",
        sessions: 1,
        turns: 2,
        totals: { input: 10, output: 2, cacheRead: 3, cacheWrite: 0, total: 15, recordedCost: 0.1 }
      }],
      totals: { input: 10, output: 2, cacheRead: 3, cacheWrite: 0, total: 15, recordedCost: 0.1 },
      coverage: {
        discoveredSessions: 1,
        scannedSessions: 1,
        skippedSessions: 0,
        unavailableSessions: 0,
        invalidSessions: 0,
        futureVersionSessions: 0,
        undatedUsageEntries: 0,
        complete: true
      }
    };

    expect(Value.Check(CommandPayloadSchemas["workspace.usage.report"], { window: "30d" })).toBe(true);
    expect(Value.Check(CommandResultSchemas["workspace.usage.report"], report)).toBe(true);
    expect(Value.Check(CommandResultSchemas["workspace.usage.report"], {
      ...report,
      reasoningTokens: 10
    })).toBe(false);
    expect(hasValidCommandContext(
      "workspace.usage.report",
      { scope: "workspace", workspaceId: "workspace-1" }
    )).toBe(true);
    expect(hasValidCommandContext("workspace.usage.report", {
      scope: "task",
      workspaceId: "workspace-1",
      taskId: "task-1",
      taskGeneration: 1
    })).toBe(false);
  });
});
