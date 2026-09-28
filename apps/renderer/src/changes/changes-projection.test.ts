import type { WorkspaceChangeView } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { selectTurnChangedFiles, upsertWorkspaceChange, workspaceRelativeChangePath } from "./changes-projection.js";

const running: WorkspaceChangeView = {
  toolCallId: "change-1",
  kind: "edit",
  path: "src/file.ts",
  pathTruncated: false,
  status: "running",
  patchTruncated: false
};

describe("upsertWorkspaceChange", () => {
  it("creates a session projection and updates the same tool call in place", () => {
    const initial = upsertWorkspaceChange(undefined, "session-1", running);
    const completed = upsertWorkspaceChange(initial, "session-1", {
      ...running,
      status: "completed",
      patch: "+complete",
      additions: 1
    });
    expect(completed).toMatchObject({ sessionId: "session-1", total: 1, truncated: false });
    expect(completed.items).toEqual([expect.objectContaining({ status: "completed", additions: 1 })]);
  });

  it("does not mix changes from another session", () => {
    const previous = upsertWorkspaceChange(undefined, "session-old", running);
    const next = upsertWorkspaceChange(previous, "session-new", { ...running, toolCallId: "new" });
    expect(next).toEqual({
      sessionId: "session-new",
      items: [{ ...running, toolCallId: "new" }],
      truncated: false,
      total: 1
    });
  });
});

describe("turn changed files", () => {
  const edit = (toolCallId: string, path: string, turnId: string | undefined, extra: Partial<WorkspaceChangeView> = {}) => ({
    kind: "edit", toolCallId, path, pathTruncated: false, status: "completed", patchTruncated: false,
    additions: 2, deletions: 1, ...(turnId ? { turnId } : {}), ...extra
  }) as WorkspaceChangeView;
  const write = (toolCallId: string, path: string, turnId: string) => ({
    kind: "write", toolCallId, path, pathTruncated: false, status: "completed", metricsTruncated: false, turnId
  }) as WorkspaceChangeView;

  it("lists one row per file for the answer's turn only, newest first, summing edit metrics", () => {
    const items = [
      edit("a1", "/work/app/src/a.ts", "turn-1"),
      edit("b1", "/work/app/src/b.ts", "turn-2"),
      edit("b2", "/work/app/src/b.ts", "turn-2", { additions: 5, deletions: 0 }),
      write("c1", "notes/plan.md", "turn-2"),
      edit("live", "/work/app/src/live.ts", undefined)
    ];
    const result = selectTurnChangedFiles(items, "turn-2", "/work/app");
    expect(result.unfinishedCount).toBe(0);
    expect(result.files).toEqual([
      { path: "notes/plan.md", relativePath: "notes/plan.md", written: true, additions: undefined, deletions: undefined, toolCallId: "c1" },
      { path: "/work/app/src/b.ts", relativePath: "src/b.ts", written: false, additions: 7, deletions: 1, toolCallId: "b2" }
    ]);
  });

  it("lists completed facts only and counts failed or interrupted ones", () => {
    const items = [
      edit("ok", "src/ok.ts", "turn-1"),
      edit("failed", "src/failed.ts", "turn-1", { status: "failed" }),
      edit("interrupted", "src/interrupted.ts", "turn-1", { status: "interrupted" }),
      edit("running", "src/running.ts", "turn-1", { status: "running" })
    ];
    const result = selectTurnChangedFiles(items, "turn-1", "/work/app");
    expect(result.files.map((file) => file.path)).toEqual(["src/ok.ts"]);
    expect(result.unfinishedCount).toBe(2);
  });

  it("offers an open action only for Workspace-contained, untruncated paths", () => {
    expect(workspaceRelativeChangePath("/work/app/src/a.ts", "/work/app")).toBe("src/a.ts");
    expect(workspaceRelativeChangePath("./src/a.ts", "/work/app")).toBe("src/a.ts");
    expect(workspaceRelativeChangePath("/work/app-other/a.ts", "/work/app")).toBeUndefined();
    expect(workspaceRelativeChangePath("/elsewhere/a.ts", "/work/app")).toBeUndefined();
    expect(workspaceRelativeChangePath("../a.ts", "/work/app")).toBeUndefined();
    expect(workspaceRelativeChangePath("/work/app/src/a.ts", undefined)).toBeUndefined();
    expect(workspaceRelativeChangePath("c:\\Users\\me\\app\\src\\a.ts", "C:\\Users\\me\\app")).toBe("src/a.ts");
    const truncated = selectTurnChangedFiles([edit("t", "/work/app/src/long…", "turn-1", { pathTruncated: true })], "turn-1", "/work/app");
    expect(truncated.files[0]?.relativePath).toBeUndefined();
  });
});
