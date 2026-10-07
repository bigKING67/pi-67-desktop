import type { ToolCallPart } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { groupExplorationRuns } from "./process-exploration.js";
import type { TranscriptProcessItem } from "./transcript-rows.js";
import { formatElapsedClock } from "./elapsed-clock.js";

const tool = (id: string, name: string, status: ToolCallPart["status"] = "completed"): TranscriptProcessItem => ({
  kind: "tool",
  key: id,
  call: { type: "tool-call", id, name, status }
});
const narration = (key: string): TranscriptProcessItem => ({ kind: "narration", key, content: key });

describe("exploration grouping", () => {
  it("collapses consecutive successful reads and searches and counts each mode", () => {
    const grouped = groupExplorationRuns([narration("n1"), tool("a", "grep"), tool("b", "read"), tool("c", "glob"), tool("d", "edit")], true);
    expect(grouped.map((entry) => entry.kind)).toEqual(["item", "exploration", "item"]);
    expect(grouped[1]).toMatchObject({ key: "exploration:a", reads: 1, searches: 2 });
  });

  it("keeps a single read, and running or failed calls, as individual steps", () => {
    expect(groupExplorationRuns([tool("a", "read"), tool("b", "edit")], true).every((entry) => entry.kind === "item")).toBe(true);
    const mixed = groupExplorationRuns([tool("a", "read"), tool("b", "read", "running"), tool("c", "read"), tool("d", "read", "failed")], true);
    expect(mixed.map((entry) => entry.kind)).toEqual(["item", "item", "item", "item"]);
  });

  it("never drops a process item", () => {
    const items = [tool("a", "read"), tool("b", "grep"), narration("n"), tool("c", "read"), tool("d", "read")];
    const flattened = groupExplorationRuns(items, true).flatMap<TranscriptProcessItem>((entry) => entry.kind === "item" ? [entry.item] : [...entry.items]);
    expect(flattened).toEqual(items);
  });

  it("keeps every call individual while the process is still running", () => {
    expect(groupExplorationRuns([tool("a", "read"), tool("b", "grep")], false).every((entry) => entry.kind === "item")).toBe(true);
  });

  it("counts distinct read targets and ignores namespaced non-Workspace tools", () => {
    const read = (id: string, path: string): TranscriptProcessItem => ({
      kind: "tool", key: id, call: { type: "tool-call", id, name: "read", status: "completed", summary: JSON.stringify({ path }) }
    });
    expect(groupExplorationRuns([read("a", "src/a.ts"), read("b", "src/a.ts"), read("c", "src/b.ts")], true)[0])
      .toMatchObject({ kind: "exploration", reads: 2, searches: 0 });
    expect(groupExplorationRuns([tool("a", "web_search"), tool("b", "mcp__notion__search")], true)
      .every((entry) => entry.kind === "item")).toBe(true);
  });

  it("formats the running clock as m:ss", () => {
    expect(formatElapsedClock(0)).toBe("0:00");
    expect(formatElapsedClock(42_900)).toBe("0:42");
    expect(formatElapsedClock(125_000)).toBe("2:05");
  });
});
