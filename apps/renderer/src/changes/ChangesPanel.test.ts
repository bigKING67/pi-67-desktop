import type { WorkspaceChangeView } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  classifyPatchLine,
  groupWorkspaceChangesByTurn,
  projectPatchLines,
  selectWorkspaceChange,
  summarizeWorkspaceChanges
} from "./ChangesPanel.js";

describe("ChangesPanel projection helpers", () => {
  it("classifies unified diff headers separately from added and removed content", () => {
    expect(classifyPatchLine("--- a/src/a.ts")).toBe("meta");
    expect(classifyPatchLine("+++ b/src/a.ts")).toBe("meta");
    expect(classifyPatchLine("@@ -1 +1 @@")).toBe("meta");
    expect(classifyPatchLine("+next")).toBe("added");
    expect(classifyPatchLine("-previous")).toBe("removed");
    expect(classifyPatchLine(" unchanged")).toBe("context");
  });

  it("caps rendered patch rows independently of the Host payload budget", () => {
    const projected = projectPatchLines("a\nb\nc\nd", 2);
    expect(projected.lines.map((line) => line.content)).toEqual(["a", "b"]);
    expect(projected.omittedLines).toBe(2);
  });

  it("keeps selection current and falls back to the newest retained record", () => {
    const items = [edit("first"), edit("latest")];
    expect(selectWorkspaceChange(items, "first")?.toolCallId).toBe("first");
    expect(selectWorkspaceChange(items, "expired")?.toolCallId).toBe("latest");
    expect(summarizeWorkspaceChanges([edit("a", "src/shared.ts"), edit("b", "src/shared.ts")], 4))
      .toBe("1 个文件 · 4 条记录");
  });

  it("groups retained Changes by the originating Pi turn", () => {
    const first = { ...edit("first"), turnId: "turn-1" };
    const second = { ...edit("second"), turnId: "turn-1" };
    const third = { ...edit("third"), turnId: "turn-2" };

    expect(groupWorkspaceChangesByTurn([first, second, third])).toEqual([
      { key: "turn-1", currentOperation: false, items: [first, second] },
      { key: "turn-2", currentOperation: false, items: [third] }
    ]);
  });

  it("keeps live changes without a persisted Turn in one current-operation group", () => {
    const first = { ...edit("live-a"), status: "running" as const };
    const second = { ...edit("live-b"), status: "pending" as const };
    expect(groupWorkspaceChangesByTurn([first, second])).toEqual([{
      key: "current-operation",
      currentOperation: true,
      items: [first, second]
    }]);
  });
});

function edit(toolCallId: string, path = "src/current.ts"): WorkspaceChangeView {
  return {
    toolCallId,
    kind: "edit",
    path,
    pathTruncated: false,
    status: "completed",
    patch: "@@ -1 +1 @@\n-old\n+new",
    patchTruncated: false,
    additions: 1,
    deletions: 1
  };
}
