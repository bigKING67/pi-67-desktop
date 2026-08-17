import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionSummary } from "@pi67/domain";
import { afterEach, describe, expect, it } from "vitest";
import { scanSessionUsage } from "./session-usage-scanner.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("scanSessionUsage", () => {
  it("rebuilds Provider/model/date totals from Pi JSONL without projecting content", async () => {
    const now = Date.UTC(2026, 7, 9, 12);
    const session = await writeSession("session-1", [
      { type: "session", version: 3, id: "session-1", cwd: "/workspace", timestamp: "2026-08-09T00:00:00.000Z" },
      {
        type: "message",
        id: "assistant-1",
        parentId: null,
        timestamp: "2026-08-09T01:00:00.000Z",
        message: {
          role: "assistant",
          provider: "groland",
          model: "gpt-5.5",
          timestamp: Date.UTC(2026, 7, 9, 1),
          content: [{ type: "text", text: "secret-answer-marker" }],
          usage: {
            input: 100,
            output: 20,
            cacheRead: 30,
            cacheWrite: 5,
            totalTokens: 155,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.125 }
          }
        }
      },
      {
        type: "compaction",
        id: "compact-1",
        parentId: "assistant-1",
        timestamp: "2026-08-09T02:00:00.000Z",
        summary: "secret-summary-marker",
        firstKeptEntryId: "assistant-1",
        tokensBefore: 1,
        usage: {
          input: 10,
          output: 3,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { total: 0.01 }
        }
      }
    ]);

    const report = await scanSessionUsage({
      workspaceId: "workspace-1",
      sessions: [session],
      discoveredSessions: 1,
      catalogIncomplete: false,
      catalogSkippedCount: 0,
      window: "7d",
      now
    });
    expect(report.totals).toEqual({
      input: 110,
      output: 23,
      cacheRead: 30,
      cacheWrite: 5,
      total: 168,
      recordedCost: 0.135
    });
    expect(report.buckets).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "groland", model: "gpt-5.5", source: "assistant-message" }),
      expect.objectContaining({ provider: "unknown", model: "unknown", source: "compaction" })
    ]));
    expect(report.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "groland",
        model: "gpt-5.5",
        sessions: 1,
        turns: 1,
        totals: expect.objectContaining({ total: 155, recordedCost: 0.125 })
      })
    ]));
    expect(report.coverage).toMatchObject({ scannedSessions: 1, complete: true });
    expect(JSON.stringify(report)).not.toContain("secret-answer-marker");
    expect(JSON.stringify(report)).not.toContain("secret-summary-marker");
  });

  it("counts unique model Sessions across dates and usage sources in the scanner", async () => {
    const first = await writeSession("first", [
      { type: "session", version: 3, id: "first", cwd: "/workspace" },
      assistantUsage("2026-08-08T01:00:00.000Z", 10),
      assistantUsage("2026-08-09T01:00:00.000Z", 20)
    ]);
    const second = await writeSession("second", [
      { type: "session", version: 3, id: "second", cwd: "/workspace" },
      assistantUsage("2026-08-09T02:00:00.000Z", 30)
    ]);

    const report = await scanSessionUsage({
      workspaceId: "workspace-1",
      sessions: [first, second],
      discoveredSessions: 2,
      catalogIncomplete: false,
      catalogSkippedCount: 0,
      window: "7d",
      now: Date.UTC(2026, 7, 9, 12)
    });

    expect(report.models).toEqual([expect.objectContaining({
      provider: "groland",
      model: "gpt-5.5",
      sessions: 2,
      turns: 3,
      totals: expect.objectContaining({ input: 60, total: 60 })
    })]);
  });

  it("uses consecutive UTC calendar dates instead of a rolling-hour cutoff", async () => {
    const session = await writeSession("utc-window", [
      { type: "session", version: 3, id: "utc-window", cwd: "/workspace" },
      assistantUsage("2026-08-03T00:01:00.000Z", 10),
      assistantUsage("2026-08-02T23:59:00.000Z", 20),
      assistantUsage("2026-08-10T00:00:00.000Z", 30)
    ]);

    const report = await scanSessionUsage({
      workspaceId: "workspace-1",
      sessions: [session],
      discoveredSessions: 1,
      catalogIncomplete: false,
      catalogSkippedCount: 0,
      window: "7d",
      now: Date.UTC(2026, 7, 9, 12)
    });

    expect(report.totals.total).toBe(10);
    expect(report.buckets).toEqual([
      expect.objectContaining({ date: "2026-08-03", totals: expect.objectContaining({ total: 10 }) })
    ]);
  });

  it("marks a future-format Session as partial coverage", async () => {
    const future = await writeSession("future", [
      { type: "session", version: 4, id: "future", cwd: "/workspace", timestamp: "2026-08-09T00:00:00.000Z" }
    ]);
    const report = await scanSessionUsage({
      workspaceId: "workspace-1",
      sessions: [future],
      discoveredSessions: 1,
      catalogIncomplete: false,
      catalogSkippedCount: 0,
      window: "30d",
      now: Date.UTC(2026, 7, 9, 12)
    });
    expect(report.coverage).toMatchObject({
      scannedSessions: 1,
      unavailableSessions: 0,
      futureVersionSessions: 1,
      complete: false
    });
  });

  it("keeps malformed Sessions out of the successful count and totals", async () => {
    const malformed = await writeRawSession("malformed", [
      JSON.stringify({ type: "session", version: 3, id: "malformed", cwd: "/workspace" }),
      JSON.stringify(assistantUsage("2026-08-09T01:00:00.000Z", 42)),
      "{not-json"
    ]);
    const report = await scanSessionUsage({
      workspaceId: "workspace-1",
      sessions: [malformed],
      discoveredSessions: 1,
      catalogIncomplete: false,
      catalogSkippedCount: 0,
      window: "30d",
      now: Date.UTC(2026, 7, 9, 12)
    });

    expect(report.coverage).toMatchObject({
      scannedSessions: 0,
      invalidSessions: 1,
      skippedSessions: 0,
      complete: false
    });
    expect(report.totals.total).toBe(0);
    expect(report.models).toEqual([]);
  });

  it("marks an unavailable Session as partial coverage", async () => {
    const existing = await writeSession("existing", []);
    const missing: SessionSummary = {
      ...existing,
      fileIdentity: "missing",
      path: `${existing.path}.missing`
    };
    const report = await scanSessionUsage({
      workspaceId: "workspace-1",
      sessions: [missing],
      discoveredSessions: 1,
      catalogIncomplete: false,
      catalogSkippedCount: 0,
      window: "30d",
      now: Date.UTC(2026, 7, 9, 12)
    });

    expect(report.coverage).toMatchObject({
      scannedSessions: 0,
      unavailableSessions: 1,
      skippedSessions: 0,
      complete: false
    });
  });
});

async function writeSession(id: string, entries: unknown[]): Promise<SessionSummary> {
  const root = await mkdtemp(join(tmpdir(), "pi67-usage-"));
  roots.push(root);
  const path = join(root, `${id}.jsonl`);
  await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  return {
    fileIdentity: `identity-${id}`,
    id,
    path,
    cwd: "/workspace",
    name: id,
    nameSource: "fallback",
    modifiedAt: Date.UTC(2026, 7, 9),
    messageCount: entries.length
  };
}

async function writeRawSession(id: string, lines: string[]): Promise<SessionSummary> {
  const root = await mkdtemp(join(tmpdir(), "pi67-usage-"));
  roots.push(root);
  const path = join(root, `${id}.jsonl`);
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return {
    fileIdentity: `identity-${id}`,
    id,
    path,
    cwd: "/workspace",
    name: id,
    nameSource: "fallback",
    modifiedAt: Date.UTC(2026, 7, 9),
    messageCount: lines.length
  };
}

function assistantUsage(timestamp: string, input: number) {
  return {
    type: "message",
    timestamp,
    message: {
      role: "assistant",
      provider: "groland",
      model: "gpt-5.5",
      timestamp,
      content: [],
      usage: {
        input,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: { total: 0 }
      }
    }
  };
}
