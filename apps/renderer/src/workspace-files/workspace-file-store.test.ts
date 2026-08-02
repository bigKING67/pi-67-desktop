import { afterEach, describe, expect, it } from "vitest";
import {
  serializeWorkspaceFileState,
  workspaceFileStore,
  workspaceHasDirtyPath
} from "./workspace-file-store.js";

const entry = {
  id: "file_1",
  name: "main.ts",
  relativePath: "src/main.ts",
  kind: "file" as const,
  revision: "revision_1",
  byteLength: 10,
  modifiedAt: 1
};

afterEach(() => {
  workspaceFileStore.setState(workspaceFileStore.getInitialState(), true);
});

describe("workspace file store", () => {
  it("deduplicates tabs, tracks drafts and detects restored revision conflicts", () => {
    const store = workspaceFileStore.getState();
    store.beginOpen("workspace-1", entry);
    store.beginOpen("workspace-1", entry);
    store.installOpenResult("workspace-1", {
      id: entry.id,
      relativePath: entry.relativePath,
      kind: "text",
      totalBytes: 10,
      revision: entry.revision,
      content: "const a=1;"
    });
    store.updateContent("workspace-1", entry.relativePath, "const a=2;");

    expect(workspaceFileStore.getState().workspaces["workspace-1"]?.tabs).toEqual([entry.relativePath]);
    expect(workspaceHasDirtyPath("workspace-1", "src", true)).toBe(true);
    expect(serializeWorkspaceFileState()).toMatchObject({
      workspaces: [{
        tabs: [{ relativePath: entry.relativePath, baseRevision: entry.revision, draft: "const a=2;" }]
      }]
    });

    store.installOpenResult("workspace-1", {
      id: entry.id,
      relativePath: entry.relativePath,
      kind: "text",
      totalBytes: 10,
      revision: "revision_external",
      content: "const a=3;"
    });
    expect(workspaceFileStore.getState().workspaces["workspace-1"]?.byPath[entry.relativePath]).toMatchObject({
      content: "const a=2;",
      dirty: true,
      conflict: true
    });
  });

  it("renames directory descendants without duplicating their tabs", () => {
    const store = workspaceFileStore.getState();
    store.hydrate({
      draftPersistence: "available",
      state: {
        version: 1,
        workspaces: [{
          workspaceId: "workspace-1",
          activeRelativePath: "src/main.ts",
          tabs: [{ relativePath: "src/main.ts" }, { relativePath: "src/lib.ts" }]
        }]
      }
    });
    store.renamePath("workspace-1", "src", "source", {
      id: "dir_1",
      name: "source",
      relativePath: "source",
      kind: "directory",
      revision: "revision_dir"
    });
    expect(workspaceFileStore.getState().workspaces["workspace-1"]).toMatchObject({
      tabs: ["source/main.ts", "source/lib.ts"],
      activeRelativePath: "source/main.ts"
    });
  });

  it("selects the adjacent file tab and then Conversation as tabs close", () => {
    const store = workspaceFileStore.getState();
    store.hydrate({
      draftPersistence: "available",
      state: {
        version: 1,
        workspaces: [{
          workspaceId: "workspace-1",
          activeRelativePath: "src/b.ts",
          tabs: [
            { relativePath: "src/a.ts" },
            { relativePath: "src/b.ts" },
            { relativePath: "src/c.ts" }
          ]
        }]
      }
    });

    store.closeTab("workspace-1", "src/b.ts");
    expect(workspaceFileStore.getState().workspaces["workspace-1"]?.activeRelativePath).toBe("src/c.ts");

    store.closeTab("workspace-1", "src/c.ts");
    expect(workspaceFileStore.getState().workspaces["workspace-1"]?.activeRelativePath).toBe("src/a.ts");

    store.closeTab("workspace-1", "src/a.ts");
    expect(workspaceFileStore.getState().workspaces["workspace-1"]).toEqual({ tabs: [], byPath: {} });
  });
});
