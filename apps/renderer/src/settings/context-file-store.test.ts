import type {
  ContextFileCatalogResult,
  ContextFileReadResult,
  ContextFileSaveResult,
  ContextFileSummary
} from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { useContextFileStore } from "./context-file-store.js";

const ITEM = contextItem();
const CATALOG: ContextFileCatalogResult = { items: [ITEM], workspaceTrusted: true };
const REVISION_A = "a".repeat(64);
const REVISION_B = "b".repeat(64);

describe("context file store", () => {
  beforeEach(() => useContextFileStore.getState().reset());

  it("keeps catalog metadata separate from on-demand Markdown content", () => {
    useContextFileStore.getState().beginCatalogLoad("workspace-a");
    useContextFileStore.getState().installCatalog("workspace-a", CATALOG);

    expect(useContextFileStore.getState()).toMatchObject({
      workspaceId: "workspace-a",
      catalog: CATALOG,
      baselineContent: undefined,
      draft: undefined,
      dirty: false,
      phase: "idle"
    });
    expect(JSON.stringify(useContextFileStore.getState().catalog)).not.toContain("private-body");
  });

  it("tracks baseline, draft, cancel, save, and revision transitions", () => {
    installCatalog();
    useContextFileStore.getState().beginRead("workspace-a", ITEM.id);
    useContextFileStore.getState().installRead("workspace-a", ITEM.id, readResult("# Baseline\n"));
    useContextFileStore.getState().updateDraft("# Private draft\n");
    expect(useContextFileStore.getState()).toMatchObject({
      baselineContent: "# Baseline\n",
      draft: "# Private draft\n",
      baselineRevision: REVISION_A,
      dirty: true
    });

    useContextFileStore.getState().discardDraft();
    expect(useContextFileStore.getState()).toMatchObject({
      draft: "# Baseline\n",
      dirty: false,
      externalConflict: false
    });

    useContextFileStore.getState().updateDraft("# Saved\n");
    useContextFileStore.getState().beginSave();
    useContextFileStore.getState().installSave(
      "workspace-a",
      ITEM.id,
      "# Saved\n",
      saveResult()
    );
    expect(useContextFileStore.getState()).toMatchObject({
      baselineContent: "# Saved\n",
      draft: "# Saved\n",
      baselineRevision: REVISION_B,
      dirty: false,
      phase: "idle"
    });
  });

  it("preserves a dirty draft across an external revision conflict", () => {
    installCatalog();
    useContextFileStore.getState().beginRead("workspace-a", ITEM.id);
    useContextFileStore.getState().installRead("workspace-a", ITEM.id, readResult("# Baseline\n"));
    useContextFileStore.getState().updateDraft("# Unsaved private draft\n");
    useContextFileStore.getState().markConflict("changed outside Desktop");

    expect(useContextFileStore.getState()).toMatchObject({
      draft: "# Unsaved private draft\n",
      baselineContent: "# Baseline\n",
      dirty: true,
      externalConflict: true,
      error: "changed outside Desktop"
    });
  });

  it("drops selected content when the active Workspace changes", () => {
    installCatalog();
    useContextFileStore.getState().beginRead("workspace-a", ITEM.id);
    useContextFileStore.getState().installRead("workspace-a", ITEM.id, readResult("# Workspace A\n"));
    useContextFileStore.getState().updateDraft("# Workspace A draft\n");

    useContextFileStore.getState().beginCatalogLoad("workspace-b");
    expect(useContextFileStore.getState()).toMatchObject({
      workspaceId: "workspace-b",
      catalog: undefined,
      selectedItem: undefined,
      baselineContent: undefined,
      draft: undefined,
      baselineRevision: undefined,
      dirty: false,
      externalConflict: false,
      phase: "loading-catalog"
    });
  });
});

function installCatalog(): void {
  useContextFileStore.getState().beginCatalogLoad("workspace-a");
  useContextFileStore.getState().installCatalog("workspace-a", CATALOG);
}

function readResult(content: string): ContextFileReadResult {
  return { item: ITEM, content, revision: REVISION_A };
}

function saveResult(): ContextFileSaveResult {
  return { item: ITEM, revision: REVISION_B, files: CATALOG };
}

function contextItem(): ContextFileSummary {
  return {
    id: `ctx_${"1".repeat(64)}`,
    name: "AGENTS.md",
    path: "/workspace/AGENTS.md",
    category: "rules-context",
    scope: "project",
    origin: "workspace",
    presence: "present",
    access: "editable",
    runtimeState: "active"
  };
}
