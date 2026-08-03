import type { WorkspaceDescriptor, WorkspaceFileEntry } from "@pi67/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { openWorkspaceFileByRelativePath } from "./workspace-file-controller.js";
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
