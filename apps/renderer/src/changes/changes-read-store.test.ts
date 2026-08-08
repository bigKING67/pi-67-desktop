import type { WorkspaceChangeView } from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  changesReadSessionKey,
  useChangesReadStore,
  workspaceChangeViewed
} from "./changes-read-store.js";

describe("Changes read state", () => {
  beforeEach(() => useChangesReadStore.getState().reset());

  it("marks one exact change revision viewed", () => {
    const change = edit("running");
    useChangesReadStore.getState().markViewed("session", change);
    const fingerprints = useChangesReadStore.getState().sessions.session?.fingerprints;

    expect(workspaceChangeViewed(fingerprints, change)).toBe(true);
    expect(workspaceChangeViewed(fingerprints, { ...change, status: "completed" })).toBe(false);
    expect(workspaceChangeViewed(fingerprints, { ...change, patch: "@@\n+changed" })).toBe(false);
  });

  it("isolates physical Sessions", () => {
    expect(changesReadSessionKey("workspace", "file-a")).toBe("workspace\u0000file-a");
    expect(changesReadSessionKey("workspace", "file-b"))
      .not.toBe(changesReadSessionKey("workspace", "file-a"));
  });
});

function edit(status: WorkspaceChangeView["status"]): Extract<WorkspaceChangeView, { kind: "edit" }> {
  return {
    kind: "edit",
    toolCallId: "edit-1",
    turnId: "turn-1",
    path: "src/index.ts",
    pathTruncated: false,
    status,
    patch: "@@\n+next",
    patchTruncated: false
  };
}
