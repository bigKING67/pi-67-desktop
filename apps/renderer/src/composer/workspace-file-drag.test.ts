import type { WorkspaceFileEntry } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  readWorkspaceFileDragData,
  transferContainsWorkspaceFile,
  writeWorkspaceFileDragData
} from "./workspace-file-drag.js";

const WORKSPACE_FILE_DRAG_MIME = "application/x-pi67-workspace-file-ref+json";

describe("workspace file drag", () => {
  it("writes only file references into the private drag payload", () => {
    const directoryTransfer = transferFixture();
    writeWorkspaceFileDragData(directoryTransfer.transfer, "workspace-a", entry({ kind: "directory" }));
    expect(directoryTransfer.data.size).toBe(0);

    const fileTransfer = transferFixture();
    writeWorkspaceFileDragData(fileTransfer.transfer, "workspace-a", entry());

    expect(fileTransfer.transfer.effectAllowed).toBe("copy");
    expect(fileTransfer.data.get(WORKSPACE_FILE_DRAG_MIME)).toBe(JSON.stringify({
      id: "file-a",
      revision: "revision-a"
    }));
  });

  it("returns a remembered reference only for the exact Workspace and revision", () => {
    const fixture = transferFixture();
    writeWorkspaceFileDragData(fixture.transfer, "workspace-a", entry());

    expect(readWorkspaceFileDragData(fixture.transfer, "workspace-a")).toEqual({
      id: "file-a",
      revision: "revision-a",
      relativePath: "src/file-a.ts"
    });
    expect(readWorkspaceFileDragData(fixture.transfer, "workspace-b")).toBeUndefined();

    fixture.data.set(WORKSPACE_FILE_DRAG_MIME, JSON.stringify({
      id: "file-a",
      revision: "stale-revision"
    }));
    expect(readWorkspaceFileDragData(fixture.transfer, "workspace-a")).toBeUndefined();
  });

  it("rejects absent, malformed, and structurally invalid payloads", () => {
    const fixture = transferFixture();
    expect(readWorkspaceFileDragData(fixture.transfer, "workspace-a")).toBeUndefined();

    fixture.data.set(WORKSPACE_FILE_DRAG_MIME, "{");
    expect(readWorkspaceFileDragData(fixture.transfer, "workspace-a")).toBeUndefined();

    fixture.data.set(WORKSPACE_FILE_DRAG_MIME, JSON.stringify({ id: 7, revision: "revision-a" }));
    expect(readWorkspaceFileDragData(fixture.transfer, "workspace-a")).toBeUndefined();

    fixture.data.set(WORKSPACE_FILE_DRAG_MIME, JSON.stringify({ id: "file-a", revision: 7 }));
    expect(readWorkspaceFileDragData(fixture.transfer, "workspace-a")).toBeUndefined();
  });

  it("detects the private drag MIME without treating other payloads as files", () => {
    expect(transferContainsWorkspaceFile(transferFixture(["text/plain"]).transfer)).toBe(false);
    expect(transferContainsWorkspaceFile(transferFixture([
      "text/plain",
      WORKSPACE_FILE_DRAG_MIME
    ]).transfer)).toBe(true);
  });
});

function entry(overrides: Partial<WorkspaceFileEntry> = {}): WorkspaceFileEntry {
  return {
    id: "file-a",
    name: "file-a.ts",
    relativePath: "src/file-a.ts",
    kind: "file",
    revision: "revision-a",
    ...overrides
  };
}

function transferFixture(types: string[] = []) {
  const data = new Map<string, string>();
  const transfer = {
    effectAllowed: "uninitialized",
    get types() { return types.length > 0 ? types : [...data.keys()]; },
    getData(type: string) { return data.get(type) ?? ""; },
    setData(type: string, value: string) { data.set(type, value); }
  } as unknown as DataTransfer;
  return { data, transfer };
}
