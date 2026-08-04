import type { OperationView, SessionSummary } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { buildSessionNavigationRows, formatSessionRelativeTime } from "./session-navigation.js";

const SESSIONS: SessionSummary[] = [
  { id: "session-live", path: "/sessions/live.jsonl", cwd: "/work", name: "修复恢复协议", nameSource: "explicit", modifiedAt: 300, messageCount: 12 },
  { id: "session-recent", path: "/sessions/recent.jsonl", cwd: "/work", name: "性能审计", nameSource: "explicit", modifiedAt: 200, messageCount: 8 },
  { id: "session-old", path: "/sessions/old.jsonl", cwd: "/work", name: "旧会话", nameSource: "explicit", modifiedAt: 100, messageCount: 4 }
];

function operation(overrides: Partial<OperationView> = {}): OperationView {
  return {
    operationId: "operation-1",
    kind: "prompt",
    lifecycle: "running",
    cancellable: true,
    sessionId: "session-live",
    sessionGeneration: 1,
    startedAt: 1,
    ...overrides
  };
}

describe("session navigation projection", () => {
  it("groups the real active operation separately from recent sessions", () => {
    const rows = buildSessionNavigationRows({
      sessions: SESSIONS,
      activePath: "/sessions/live.jsonl",
      activeSessionId: "session-live",
      operation: operation()
    });

    expect(rows.map((row) => row.kind === "group" ? row.label : row.item.session.id)).toEqual([
      "正在运行",
      "session-live",
      "最近",
      "session-recent",
      "session-old"
    ]);
    expect(rows[1]).toMatchObject({ kind: "session", item: { active: true, status: "running" } });
  });

  it("distinguishes waiting input from running and does not present terminal operations as live", () => {
    const waitingRows = buildSessionNavigationRows({ sessions: SESSIONS, operation: operation({ lifecycle: "waiting-input" }) });
    const terminalRows = buildSessionNavigationRows({ sessions: SESSIONS, operation: operation({ lifecycle: "completed" }) });

    expect(waitingRows[1]).toMatchObject({ kind: "session", item: { status: "waiting" } });
    expect(terminalRows[0]).toMatchObject({ kind: "group", id: "recent" });
  });

  it("does not attach a session-running state to session import operations", () => {
    const rows = buildSessionNavigationRows({
      sessions: SESSIONS,
      activePath: "/sessions/live.jsonl",
      operation: operation({ kind: "session-import" })
    });

    expect(rows[0]).toMatchObject({ kind: "group", id: "recent" });
    expect(rows[1]).toMatchObject({ kind: "session", item: { status: "active" } });
  });

  it("preserves server ordering and defensively removes duplicate paths", () => {
    const rows = buildSessionNavigationRows({ sessions: [...SESSIONS, SESSIONS[1]!] });

    expect(rows.map((row) => row.kind === "group" ? row.label : row.item.session.id)).toEqual([
      "最近",
      "session-live",
      "session-recent",
      "session-old"
    ]);
  });

  it("formats relative times against an explicit clock", () => {
    const now = Date.UTC(2026, 6, 24, 10, 0, 0);
    expect(formatSessionRelativeTime(now - 30_000, now)).toBe("刚刚");
    expect(formatSessionRelativeTime(now - 15 * 60_000, now)).toBe("15 分钟前");
    expect(formatSessionRelativeTime(now - 3 * 3_600_000, now)).toBe("3 小时前");
    expect(formatSessionRelativeTime(Number.NaN, now)).toBe("时间未知");
  });
});
