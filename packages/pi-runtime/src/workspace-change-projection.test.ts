import { mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  MAX_WORKSPACE_CHANGES,
  MAX_WORKSPACE_CHANGES_JSON_BYTES,
  MAX_WORKSPACE_CHANGE_PATCH_BYTES,
  MAX_WORKSPACE_CHANGE_PATH_BYTES
} from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  projectLiveWorkspaceChangeEnd,
  projectLiveWorkspaceChangeStart,
  projectWorkspaceChanges
} from "./workspace-change-projection.js";

describe("projectWorkspaceChanges", () => {
  it("round-trips edit patch details through the Pi JSONL source of truth", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-changes-"));
    try {
      const sessionDir = join(root, "sessions");
      mkdirSync(sessionDir);
      const manager = SessionManager.create(root, sessionDir, { id: "changes-roundtrip" });
      manager.appendMessage(assistantToolCall("edit-1", "edit", {
        path: "src/example.ts",
        edits: [{ oldText: "before", newText: "after" }]
      }));
      manager.appendMessage(toolResult("edit-1", "edit", false, {
        diff: "-before\n+after",
        patch: "--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-before\n+after",
        firstChangedLine: 1
      }));
      const file = manager.getSessionFile();
      if (!file) throw new Error("Expected a persisted session file.");

      const projection = projectWorkspaceChanges(SessionManager.open(file));
      expect(projection).toEqual({
        sessionId: "changes-roundtrip",
        items: [{
          toolCallId: "edit-1",
          kind: "edit",
          path: "src/example.ts",
          pathTruncated: false,
          status: "completed",
          patch: "--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-before\n+after",
          patchTruncated: false,
          additions: 1,
          deletions: 1,
          firstChangedLine: 1
        }],
        truncated: false,
        total: 1
      });
      expect(readFileSync(file, "utf8")).toContain('"patch":"--- a/src/example.ts');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports writes without transporting their source content or inventing a diff", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "write-change" });
    const secretSource = "const privateSourceMarker = true;\n";
    manager.appendMessage(assistantToolCall("write-1", "write", {
      path: "src/new.ts",
      content: secretSource
    }));
    manager.appendMessage(toolResult("write-1", "write", false, undefined));

    const projection = projectWorkspaceChanges(manager);
    expect(projection.items[0]).toMatchObject({
      kind: "write",
      status: "completed",
      writtenBytes: Buffer.byteLength(secretSource),
      writtenLines: 2,
      metricsTruncated: false
    });
    expect(projection.items[0]).not.toHaveProperty("patch");
    expect(JSON.stringify(projection)).not.toContain("privateSourceMarker");
  });

  it("groups historical changes by the nearest preceding user Turn entry", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "turn-grouped-changes" });
    const firstTurnId = manager.appendMessage({ role: "user", content: "First turn", timestamp: 1 });
    manager.appendMessage(assistantToolCall("edit-first", "edit", { path: "first.ts", edits: [] }));
    manager.appendMessage(toolResult("edit-first", "edit", false, { diff: "valid", patch: "+first" }));
    const secondTurnId = manager.appendMessage({ role: "user", content: "Second turn", timestamp: 2 });
    manager.appendMessage(assistantToolCall("write-second", "write", { path: "second.ts", content: "second" }));
    manager.appendMessage(toolResult("write-second", "write", false, undefined));

    expect(projectWorkspaceChanges(manager).items.map((item) => ({
      toolCallId: item.toolCallId,
      turnId: item.turnId
    }))).toEqual([
      { toolCallId: "edit-first", turnId: firstTurnId },
      { toolCallId: "write-second", turnId: secondTurnId }
    ]);
  });

  it("bounds item count, paths, patches and the complete projection", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "bounded-changes" });
    for (let index = 0; index < MAX_WORKSPACE_CHANGES + 20; index += 1) {
      const id = `edit-${index}`;
      manager.appendMessage(assistantToolCall(id, "edit", {
        path: `${"路".repeat(MAX_WORKSPACE_CHANGE_PATH_BYTES)}-${index}`,
        edits: []
      }));
      manager.appendMessage(toolResult(id, "edit", false, {
        diff: "valid",
        patch: `+${"x".repeat(MAX_WORKSPACE_CHANGE_PATCH_BYTES)}`
      }));
    }

    const projection = projectWorkspaceChanges(manager);
    expect(projection.total).toBe(MAX_WORKSPACE_CHANGES + 20);
    expect(projection.items.length).toBeLessThanOrEqual(MAX_WORKSPACE_CHANGES);
    expect(projection.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(projection), "utf8")).toBeLessThanOrEqual(MAX_WORKSPACE_CHANGES_JSON_BYTES);
    expect(projection.items.every((item) => Buffer.byteLength(item.path, "utf8") <= MAX_WORKSPACE_CHANGE_PATH_BYTES)).toBe(true);
    expect(projection.items.every((item) => item.kind === "edit"
      && (!item.patch || Buffer.byteLength(item.patch, "utf8") <= MAX_WORKSPACE_CHANGE_PATCH_BYTES))).toBe(true);
    expect(projection.items.every((item) => item.kind === "edit" && item.pathTruncated && item.patchTruncated)).toBe(true);
    expect(projection.items.every((item) => item.kind === "edit"
      && item.additions === undefined
      && item.deletions === undefined)).toBe(true);
  });

  it("handles failed, interrupted, active and malformed tool records truthfully", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "status-changes" });
    manager.appendMessage(assistantToolCall("failed", "edit", { path: "failed.ts", edits: [] }));
    manager.appendMessage(toolResult("failed", "edit", true, { patch: "+not-trusted", diff: "invalid" }));
    manager.appendMessage(assistantToolCall("interrupted", "edit", { path: "interrupted.ts", edits: [] }));
    manager.appendMessage(assistantToolCall("active", "write", { path: "active.ts", content: "active" }));
    manager.appendMessage(assistantToolCall("malformed", "edit", { path: 123, edits: [] }));

    const projection = projectWorkspaceChanges(manager, new Set(["active"]));
    expect(projection.items.map((item) => [item.toolCallId, item.status])).toEqual([
      ["failed", "failed"],
      ["interrupted", "interrupted"],
      ["active", "running"]
    ]);
    expect(projection.items[0]).not.toHaveProperty("patch");
  });

  it("projects bounded live start and completion events", () => {
    const start = projectLiveWorkspaceChangeStart({
      toolCallId: "live-edit",
      toolName: "edit",
      args: { path: "src/live.ts", edits: [] }
    });
    expect(start).toMatchObject({ status: "running", path: "src/live.ts" });
    if (!start) throw new Error("Expected a live change.");
    expect(projectLiveWorkspaceChangeEnd(start, "edit", {
      details: { diff: "-a\n+b", patch: "--- a\n+++ b\n-a\n+b", firstChangedLine: 2 }
    }, false)).toMatchObject({ status: "completed", additions: 1, deletions: 1, firstChangedLine: 2 });
  });

  it("does not trust a mismatched tool result as an edit patch", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "mismatched-result" });
    manager.appendMessage(assistantToolCall("call-1", "edit", { path: "src/file.ts", edits: [] }));
    manager.appendMessage(toolResult("call-1", "write", false, {
      diff: "-secret",
      patch: "--- a/src/file.ts\n+++ b/src/file.ts\n-secret"
    }));

    const [change] = projectWorkspaceChanges(manager).items;
    expect(change).toMatchObject({ kind: "edit", status: "failed", patchTruncated: false });
    expect(change).not.toHaveProperty("patch");
  });

  it("keeps large patches and write metrics on bounded inspection paths", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "large-change-inputs" });
    manager.appendMessage(assistantToolCall("large-edit", "edit", { path: "large.ts", edits: [] }));
    manager.appendMessage(toolResult("large-edit", "edit", false, {
      diff: "valid",
      patch: `--- a/large.ts\n+++ b/large.ts\n@@ -1 +1 @@\n-${"a".repeat(64 * 1024 * 1024)}`
    }));
    manager.appendMessage(assistantToolCall("large-write", "write", {
      path: "generated.bin",
      content: "x".repeat(64 * 1024 * 1024)
    }));
    manager.appendMessage(toolResult("large-write", "write", false, undefined));

    const projection = projectWorkspaceChanges(manager);
    const edit = projection.items.find((item) => item.toolCallId === "large-edit");
    const write = projection.items.find((item) => item.toolCallId === "large-write");
    expect(edit).toMatchObject({ kind: "edit", patchTruncated: true });
    expect(write).toEqual(expect.objectContaining({ kind: "write", metricsTruncated: true }));
    expect(write).not.toHaveProperty("writtenBytes");
    expect(Buffer.byteLength(JSON.stringify(projection), "utf8")).toBeLessThanOrEqual(MAX_WORKSPACE_CHANGES_JSON_BYTES);
  });

  it("distinguishes active, sequentially pending and historical interrupted calls", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "pending-change" });
    manager.appendMessage(assistantToolCall("historical", "edit", { path: "old.ts", edits: [] }));
    manager.appendMessage({
      ...assistantToolCall("active", "edit", { path: "active.ts", edits: [] }),
      content: [
        { type: "toolCall" as const, id: "active", name: "edit", arguments: { path: "active.ts", edits: [] } },
        { type: "toolCall" as const, id: "next", name: "write", arguments: { path: "next.ts", content: "next" } }
      ]
    });

    expect(projectWorkspaceChanges(manager, new Set(["active"]), true).items.map((item) => [item.toolCallId, item.status])).toEqual([
      ["historical", "interrupted"],
      ["active", "running"],
      ["next", "pending"]
    ]);
  });

  it("rejects overlong join identifiers instead of truncating them into collisions", () => {
    const manager = SessionManager.inMemory("/tmp", { id: "identifier-bound" });
    const prefix = "x".repeat(512);
    manager.appendMessage(assistantToolCall(`${prefix}-a`, "edit", { path: "a.ts", edits: [] }));
    manager.appendMessage(toolResult(`${prefix}-b`, "edit", false, { diff: "valid", patch: "+wrong" }));
    expect(projectWorkspaceChanges(manager).items).toEqual([]);
  });
});

function assistantToolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    role: "assistant" as const,
    content: [{ type: "toolCall" as const, id, name, arguments: args }],
    api: "openai-responses" as const,
    provider: "openai" as const,
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "toolUse" as const,
    timestamp: Date.now()
  };
}

function toolResult(id: string, name: string, isError: boolean, details: unknown) {
  return {
    role: "toolResult" as const,
    toolCallId: id,
    toolName: name,
    content: [{ type: "text" as const, text: isError ? "failed" : "complete" }],
    details,
    isError,
    timestamp: Date.now()
  };
}
