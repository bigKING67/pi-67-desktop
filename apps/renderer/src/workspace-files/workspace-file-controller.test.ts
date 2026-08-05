import type { WorkspaceDescriptor, WorkspaceFileEntry } from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import {
  createWorkspaceEntry,
  openWorkspaceFileByRelativePath,
  reloadWorkspaceFile,
  renameWorkspaceEntry,
  saveWorkspaceDraftAs
} from "./workspace-file-controller.js";
import { workspaceFileStore } from "./workspace-file-store.js";

vi.mock("../workbench/workspace-host-registration-controller.js", () => ({
  registerRendererWorkspaceWithHost: vi.fn()
}));

const registerWorkspace = vi.mocked(registerRendererWorkspaceWithHost);

describe("workspace file controller Markdown links", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    registerWorkspace.mockReset().mockResolvedValue(true);
    workspaceFileStore.setState(workspaceFileStore.getInitialState(), true);
    useNotificationStore.getState().clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves and opens one Workspace-relative regular file", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.file.resolve") return { entry: fileEntry() } as never;
      if (type === "workspace.file.open") {
        return {
          id: "file-main",
          relativePath: "src/main.ts",
          kind: "text",
          totalBytes: 18,
          revision: "revision-1",
          content: "export const pi = 67;"
        } as never;
      }
      throw new Error(`Unexpected command: ${type}`);
    });

    await expect(openWorkspaceFileByRelativePath(workspace(), "src/main.ts")).resolves.toBe(true);

    expect(registerWorkspace).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.map(([type]) => type)).toEqual([
      "workspace.file.resolve",
      "workspace.file.open"
    ]);
    expect(workspaceFileStore.getState().workspaces["workspace-a"]?.activeRelativePath)
      .toBe("src/main.ts");
  });

  it("rejects a resolved directory before issuing an open command", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      entry: { ...fileEntry(), kind: "directory" }
    } as never);

    await expect(openWorkspaceFileByRelativePath(workspace(), "src")).resolves.toBe(false);

    expect(request).toHaveBeenCalledTimes(1);
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "无法打开工作区链接"
    });
  });

  it("does not resolve a link when the Workspace cannot be registered", async () => {
    registerWorkspace.mockResolvedValue(false);
    const request = vi.spyOn(agentConnectionController, "request");

    await expect(openWorkspaceFileByRelativePath(workspace(), "src/main.ts")).resolves.toBe(false);

    expect(request).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法打开工作区链接",
      message: "工作区当前不可用。"
    });
  });
});

describe("workspace file controller mutations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    registerWorkspace.mockReset().mockResolvedValue(true);
    workspaceFileStore.setState(workspaceFileStore.getInitialState(), true);
    useNotificationStore.getState().clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a created entry for inline dialog completion", async () => {
    vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.file.create") return { entry: fileEntry() } as never;
      if (type === "workspace.file.open") return {
        id: "file-main",
        relativePath: "src/main.ts",
        kind: "text",
        totalBytes: 0,
        content: "",
        revision: "revision-main"
      } as never;
      throw new Error(`Unexpected command: ${type}`);
    });

    await expect(createWorkspaceEntry(workspace(), undefined, "main.ts", "file"))
      .resolves.toEqual({ ok: true, value: fileEntry() });
  });

  it("returns a localized conflict without collapsing the dialog into a Toast", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new ProtocolRequestError({
      code: "RESOURCE_CHANGED_EXTERNALLY",
      message: "目标名称已存在。",
      recoverable: false
    }));

    await expect(renameWorkspaceEntry(workspace(), fileEntry(), "existing.ts"))
      .resolves.toEqual({ ok: false, message: "此位置已经存在同名文件或文件夹。" });
    expect(useNotificationStore.getState().items).toEqual([]);
  });

  it("resolves a restored dirty tab before explicitly replacing its draft", async () => {
    workspaceFileStore.getState().hydrate({
      draftPersistence: "available",
      state: {
        version: 1,
        workspaces: [{
          workspaceId: "workspace-a",
          activeRelativePath: "src/main.ts",
          tabs: [{ relativePath: "src/main.ts", baseRevision: "revision-old", draft: "local draft" }]
        }]
      }
    });
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "workspace.file.resolve") return { entry: fileEntry() } as never;
      if (type === "workspace.file.open") return {
        id: "file-main",
        relativePath: "src/main.ts",
        kind: "text",
        totalBytes: 12,
        content: "disk content",
        revision: "revision-1"
      } as never;
      throw new Error(`Unexpected command: ${type}`);
    });

    await expect(reloadWorkspaceFile(workspace(), "src/main.ts")).resolves.toBe(true);

    expect(request.mock.calls.map(([type]) => type)).toEqual([
      "workspace.file.resolve",
      "workspace.file.open"
    ]);
    expect(workspaceFileStore.getState().workspaces["workspace-a"]?.byPath["src/main.ts"])
      .toMatchObject({ content: "disk content", dirty: false, revision: "revision-1" });
  });

  it("writes a conflict draft before opening the Save As file", async () => {
    const source = { ...fileEntry(), id: "file-readme", name: "README.md", relativePath: "README.md" };
    const recovered = { ...fileEntry(), id: "file-recovered", name: "README-copy.md", relativePath: "README-copy.md" };
    const store = workspaceFileStore.getState();
    store.beginOpen("workspace-a", source);
    store.installOpenResult("workspace-a", {
      id: source.id,
      relativePath: source.relativePath,
      kind: "text",
      totalBytes: 8,
      content: "original",
      revision: source.revision
    });
    store.updateContent("workspace-a", source.relativePath, "preserved draft");
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type, payload) => {
      if (type === "workspace.file.create") return { entry: recovered } as never;
      if (type === "workspace.file.save") {
        expect(payload).toMatchObject({ id: recovered.id, content: "preserved draft" });
        return { entry: { ...recovered, revision: "revision-saved" } } as never;
      }
      if (type === "workspace.file.open") return {
        id: recovered.id,
        relativePath: recovered.relativePath,
        kind: "text",
        totalBytes: 15,
        content: "preserved draft",
        revision: "revision-saved"
      } as never;
      throw new Error(`Unexpected command: ${type}`);
    });

    await expect(saveWorkspaceDraftAs(workspace(), source.relativePath, recovered.name))
      .resolves.toEqual({ ok: true, value: { ...recovered, revision: "revision-saved" } });
    expect(request.mock.calls.map(([type]) => type)).toEqual([
      "workspace.file.create",
      "workspace.file.save",
      "workspace.file.open"
    ]);
    expect(workspaceFileStore.getState().workspaces["workspace-a"]?.byPath[source.relativePath]).toBeUndefined();
    expect(workspaceFileStore.getState().workspaces["workspace-a"]?.byPath[recovered.relativePath]?.content)
      .toBe("preserved draft");
  });
});

function workspace(): WorkspaceDescriptor {
  return {
    id: "workspace-a",
    displayName: "Workspace A",
    identity: {
      canonicalPath: "/work/a",
      assurance: "filesystem",
      device: "1",
      inode: "workspace-a"
    },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}

function fileEntry(): WorkspaceFileEntry {
  return {
    id: "file-main",
    name: "main.ts",
    relativePath: "src/main.ts",
    kind: "file",
    revision: "revision-1",
    byteLength: 18,
    modifiedAt: 1
  };
}
