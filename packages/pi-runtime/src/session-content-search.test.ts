import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { searchWorkspaceSessionContent } from "./session-content-search.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Workspace Session content search", () => {
  it("scans bounded active Pi JSONL branches without persisting message bodies", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-session-content-search-"));
    roots.push(root);
    const sessionsDirectory = join(root, "sessions");
    const first = SessionManager.create(root, sessionsDirectory, { id: "search-first" });
    const firstUser = first.appendMessage({ role: "user", content: "Find release marker", timestamp: 1 });
    const firstAssistant = first.appendMessage(assistantMessage("Release marker is alpha.12", 2));
    const second = SessionManager.create(root, sessionsDirectory, { id: "search-second" });
    second.appendMessage({ role: "user", content: "Unrelated", timestamp: 3 });
    second.appendMessage(assistantMessage("No match", 4));
    const malformedPath = join(root, "malformed.jsonl");
    await writeFile(malformedPath, "not-json\n", "utf8");
    const firstPath = await realpath(first.getSessionFile()!);
    const secondPath = await realpath(second.getSessionFile()!);

    const result = await searchWorkspaceSessionContent({
      workspaceId: "workspace-a",
      query: "release marker",
      sessions: [
        summary("file-second", secondPath, "Second", 20),
        summary("file-first", firstPath, "First", 10),
        summary("file-malformed", malformedPath, "Malformed", 5)
      ],
      catalogTotal: 3,
      catalogIncomplete: false,
      catalogSkippedCount: 0,
      deadlineMs: 5_000
    });

    expect(result).toMatchObject({
      workspaceId: "workspace-a",
      sessionsVisited: 2,
      skippedCount: 1,
      incomplete: true,
      truncated: false
    });
    expect(result.items).toEqual([expect.objectContaining({
      sessionFileIdentity: "file-first",
      sessionName: "First",
      messageId: firstUser,
      role: "user"
    })]);
    expect(result.items.map((item) => item.messageId)).not.toContain(firstAssistant);
    expect(result.items.every((item) => Array.from(item.snippet).length <= 240)).toBe(true);
  });
});

function summary(fileIdentity: string, path: string, name: string, modifiedAt: number) {
  return {
    fileIdentity,
    id: fileIdentity,
    path,
    cwd: roots[0]!,
    name,
    nameSource: "explicit" as const,
    modifiedAt,
    messageCount: 2
  };
}

function assistantMessage(text: string, timestamp: number) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-responses" as const,
    provider: "pi67-test",
    model: "fixture",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop" as const,
    timestamp
  };
}
