import type { SessionSummary } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { filterPaletteSessionFallback } from "./use-palette-sessions.js";

const SESSIONS: SessionSummary[] = [
  { id: "protocol", path: "/sessions/protocol.jsonl", cwd: "/work/pi", name: "重构协议层", modifiedAt: 2, messageCount: 3 },
  { id: "ui", path: "/sessions/ui.jsonl", cwd: "/work/桌面", name: "Command Palette", modifiedAt: 1, messageCount: 4 }
];

describe("command palette Session fallback", () => {
  it("normalizes Unicode queries and searches only the bounded recent page", () => {
    expect(filterPaletteSessionFallback(SESSIONS, "  command  ").map((session) => session.id)).toEqual(["ui"]);
    expect(filterPaletteSessionFallback(SESSIONS, "桌面").map((session) => session.id)).toEqual(["ui"]);
    expect(filterPaletteSessionFallback(SESSIONS, "missing")).toEqual([]);
  });
});
