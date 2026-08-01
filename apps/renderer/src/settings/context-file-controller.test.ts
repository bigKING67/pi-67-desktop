import type {
  ContextFileCatalogResult,
  ContextFileReadResult,
  ContextFileSaveResult,
  ContextFileSummary
} from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { resetWorkspaceHostRegistrationState } from "../workbench/workspace-host-registration-controller.js";
import {
  loadContextFileCatalog,
  readContextFile,
  resetContextFileLoadState,
  saveSelectedContextFile
} from "./context-file-controller.js";
import { useContextFileStore } from "./context-file-store.js";

const ITEM = contextItem();
const CATALOG: ContextFileCatalogResult = { items: [ITEM], workspaceTrusted: true };
const REVISION_A = "a".repeat(64);
const REVISION_B = "b".repeat(64);

describe("context file controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rendererWorkbenchStore.getState().reset();
    resetWorkspaceHostRegistrationState();
    resetContextFileLoadState();
    useNotificationStore.getState().clear();
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-context",
      displayName: "Context files",
      identity: { canonicalPath: "/work/context", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({
      appInstanceId: "app",
      hostInstanceId: "host",
      hostEpoch: 2,
      sdkVersion: "fixture",
      eventSequence: 0
    });
  });

  it("loads the catalog through Workspace authority without putting file content in it", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.register") return { registered: true } as never;
      if (type === "context.file.list") return CATALOG as never;
      throw new Error(`Unexpected command: ${type}`);
    });

    await expect(loadContextFileCatalog("workspace-context")).resolves.toBe(true);
    expect(request).toHaveBeenNthCalledWith(2,
      "context.file.list",
      {},
      [],
      { context: { scope: "workspace", workspaceId: "workspace-context" } }
    );
    expect(useContextFileStore.getState()).toMatchObject({
      workspaceId: "workspace-context",
      catalog: CATALOG,
      draft: undefined,
      baselineContent: undefined
    });
  });

  it("reads on demand and saves only opaque id, revision, and Markdown content", async () => {
    const read: ContextFileReadResult = {
      item: ITEM,
      content: "# Baseline\n",
      revision: REVISION_A
    };
    const saved: ContextFileSaveResult = {
      item: ITEM,
      revision: REVISION_B,
      files: CATALOG
    };
    installCatalog();
    const request = vi.spyOn(agentConnectionController, "request")
      .mockResolvedValueOnce(read as never)
      .mockResolvedValueOnce(saved as never);

    await expect(readContextFile(ITEM.id, "workspace-context")).resolves.toBe(true);
    useContextFileStore.getState().updateDraft("# Private draft marker\n");
    await expect(saveSelectedContextFile("workspace-context")).resolves.toBe(true);

    expect(request).toHaveBeenNthCalledWith(2,
      "context.file.save",
      {
        id: ITEM.id,
        expectedRevision: REVISION_A,
        content: "# Private draft marker\n"
      },
      [],
      { context: { scope: "workspace", workspaceId: "workspace-context" } }
    );
    const savePayload = request.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(Object.keys(savePayload).sort()).toEqual(["content", "expectedRevision", "id"]);
    expect(savePayload).not.toHaveProperty("path");
    expect(JSON.stringify(useNotificationStore.getState().items)).not.toContain("Private draft marker");
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "success",
      title: "AGENTS.md 已保存",
      message: "项目专属 · Pi 资源已重新加载。"
    });
  });

  it("preserves the draft and blocks repeat save after an external revision conflict", async () => {
    installCatalog();
    useContextFileStore.getState().beginRead("workspace-context", ITEM.id);
    useContextFileStore.getState().installRead("workspace-context", ITEM.id, {
      item: ITEM,
      content: "# Baseline\n",
      revision: REVISION_A
    });
    useContextFileStore.getState().updateDraft("# Unsaved private conflict draft\n");
    const request = vi.spyOn(agentConnectionController, "request").mockRejectedValue(
      new ProtocolRequestError({
        code: "RESOURCE_CHANGED_EXTERNALLY",
        message: "The context file changed outside Desktop.",
        recoverable: true
      })
    );

    await expect(saveSelectedContextFile("workspace-context")).resolves.toBe(false);
    expect(useContextFileStore.getState()).toMatchObject({
      draft: "# Unsaved private conflict draft\n",
      dirty: true,
      externalConflict: true,
      phase: "idle"
    });
    expect(JSON.stringify(useNotificationStore.getState().items)).not.toContain("Unsaved private conflict draft");
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "文件已在外部修改"
    });

    await expect(saveSelectedContextFile("workspace-context")).resolves.toBe(false);
    expect(request).toHaveBeenCalledOnce();
  });
});

function installCatalog(): void {
  useContextFileStore.getState().beginCatalogLoad("workspace-context");
  useContextFileStore.getState().installCatalog("workspace-context", CATALOG);
}

function contextItem(): ContextFileSummary {
  return {
    id: `ctx_${"1".repeat(64)}`,
    name: "AGENTS.md",
    path: "/work/context/AGENTS.md",
    category: "rules-context",
    scope: "project",
    origin: "workspace",
    presence: "present",
    access: "editable",
    runtimeState: "active"
  };
}
