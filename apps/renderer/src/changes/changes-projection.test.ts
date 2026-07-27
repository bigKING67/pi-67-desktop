import type { WorkspaceChangeView } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { upsertWorkspaceChange } from "./changes-projection.js";

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
