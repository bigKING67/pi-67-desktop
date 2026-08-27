import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...arguments_: unknown[]) => unknown>(),
  ipcHandle: vi.fn()
}));

vi.mock("electron", () => ({
  app: { getVersion: vi.fn(() => "0.1.0"), isPackaged: false },
  clipboard: { writeText: vi.fn() },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 1 })),
    showOpenDialog: vi.fn()
  },
  ipcMain: { handle: mocks.ipcHandle },
  Menu: { buildFromTemplate: vi.fn() },
  net: { fetch: vi.fn() },
  Notification: class {},
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(async () => ""),
    showItemInFolder: vi.fn(),
    trashItem: vi.fn()
  }
}));

vi.mock("./browser67-integration.js", () => ({
  openBrowser67ExtensionPage: vi.fn(async () => true)
}));

import { registerSystemBridge } from "./system-bridge.js";

describe("system bridge repository environment inspection", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.ipcHandle.mockReset();
    mocks.ipcHandle.mockImplementation((channel: string, handler: (...arguments_: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    });
  });

  it("forwards only a validated Workspace identity to Main-owned Git inspection", async () => {
    const inspect = vi.fn(async () => ({
      workspaceId: "workspace-a",
      status: "non-git",
      revision: 1,
      observedAt: 1,
      stale: false,
      worktrees: []
    }));
    registerFixture(inspect);

    await expect(invoke("pi67:repository-environment-inspect", { workspaceId: "workspace-a" }))
      .resolves.toMatchObject({ status: "non-git" });
    expect(inspect).toHaveBeenCalledWith({ workspaceId: "workspace-a" });

    await expect(invoke("pi67:repository-environment-inspect", {
      workspaceId: "workspace-a",
      cwd: "/private/repository",
      gitArgs: ["worktree", "add"]
    })).rejects.toThrow("Repository environment inspection request is invalid.");
    expect(inspect).toHaveBeenCalledOnce();
  });

  it("rejects an invalid Main projection before returning it to Preload", async () => {
    registerFixture(vi.fn(async () => ({
      workspaceId: "workspace-a",
      status: "ready",
      commonDir: "/private/repository/.git"
    })));

    await expect(invoke("pi67:repository-environment-inspect", { workspaceId: "workspace-a" }))
      .rejects.toThrow("Repository environment inspection response is invalid.");
  });

  it("forwards only opaque working-tree identities and validates Main projections", async () => {
    const changeId = `chg_${"a".repeat(32)}`;
    const inspectWorkingTree = vi.fn(async () => ({
      workspaceId: "workspace-a",
      revision: 1,
      observedAt: 1,
      changes: [{
        changeId,
        displayPath: "src/current.ts",
        kind: "modified",
        staged: false,
        unstaged: true,
        conflicted: false
      }],
      truncated: false
    }));
    const detail = vi.fn(async () => ({
      workspaceId: "workspace-a",
      revision: 1,
      changeId,
      contentFingerprint: "b".repeat(64),
      unstagedPatch: "patch",
      truncated: false
    }));
    registerFixture(vi.fn(), { inspect: inspectWorkingTree, detail });

    await expect(invoke("pi67:repository-working-tree-inspect", { workspaceId: "workspace-a" }))
      .resolves.toMatchObject({ revision: 1 });
    await expect(invoke("pi67:repository-change-detail", {
      workspaceId: "workspace-a",
      revision: 1,
      changeId
    })).resolves.toMatchObject({ contentFingerprint: "b".repeat(64) });
    expect(detail).toHaveBeenCalledWith({ workspaceId: "workspace-a", revision: 1, changeId });

    await expect(invoke("pi67:repository-change-detail", {
      workspaceId: "workspace-a",
      revision: 1,
      changeId,
      path: "/private/repository/src/current.ts"
    })).rejects.toThrow("Invalid repository change detail request.");
    expect(detail).toHaveBeenCalledOnce();
  });

  it("admits only explicit bounded Submodule and app-owned Worktree recovery actions", async () => {
    const initializeSubmodules = vi.fn(async () => ({
      status: "initialized" as const,
      submodules: {
        status: "complete" as const,
        total: 1,
        uninitialized: 0,
        divergent: 0,
        conflicted: 0,
        networkActionRequired: false
      }
    }));
    const recoverAppOwnedWorktree = vi.fn(async () => ({
      status: "rejected" as const,
      error: "not-recoverable" as const,
      recoverable: false
    }));
    registerFixture(vi.fn(), undefined, undefined, { initializeSubmodules, recoverAppOwnedWorktree });

    await expect(invoke("pi67:repository-submodules-initialize", {
      workspaceId: "workspace-a",
      mode: "network-explicit"
    })).resolves.toMatchObject({ status: "initialized", submodules: { status: "complete" } });
    await expect(invoke("pi67:app-owned-worktree-recover", {
      workspaceId: "workspace-a",
      confirmation: "recreate-committed-state"
    })).resolves.toEqual({ status: "rejected", error: "not-recoverable", recoverable: false });
    expect(initializeSubmodules).toHaveBeenCalledWith({ workspaceId: "workspace-a", mode: "network-explicit" });
    expect(recoverAppOwnedWorktree).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      confirmation: "recreate-committed-state"
    });

    await expect(invoke("pi67:repository-submodules-initialize", {
      workspaceId: "workspace-a",
      mode: "local-only",
      gitArgs: ["submodule", "update"]
    })).resolves.toEqual({ status: "rejected", error: "invalid-request" });
    await expect(invoke("pi67:app-owned-worktree-recover", {
      workspaceId: "workspace-a",
      confirmation: "recreate-committed-state",
      targetPath: "/private/worktree"
    })).resolves.toEqual({ status: "rejected", error: "invalid-request", recoverable: false });
    expect(initializeSubmodules).toHaveBeenCalledOnce();
    expect(recoverAppOwnedWorktree).toHaveBeenCalledOnce();

    initializeSubmodules.mockRejectedValueOnce(new Error("private Git arguments"));
    await expect(invoke("pi67:repository-submodules-initialize", {
      workspaceId: "workspace-a",
      mode: "network-explicit"
    })).resolves.toEqual({ status: "rejected", error: "internal" });
  });

  it("keeps Prompt Stash image IPC opaque and validates Main metadata", async () => {
    const store = vi.fn(async (request: { itemId: string }) => ({
      itemId: request.itemId,
      attachments: [{
        blobId: "blob-a",
        name: "screen.png",
        mimeType: "image/png",
        byteLength: 8,
        kind: "image"
      }]
    }));
    const restore = vi.fn(async (request: { itemId: string }) => ({
      itemId: request.itemId,
      attachments: [{
        id: "attachment-restored",
        name: "screen.png",
        mimeType: "image/png",
        byteLength: 8,
        kind: "image"
      }]
    }));
    const remove = vi.fn(async () => undefined);
    registerFixture(vi.fn(), undefined, { store, restore, delete: remove });

    const opaqueStore = {
      workspaceId: "workspace-a",
      taskId: "task-a",
      itemId: "stash-a",
      attachmentIds: ["attachment-a"]
    };
    await expect(invoke("pi67:prompt-stash-images-store", opaqueStore))
      .resolves.toMatchObject({ itemId: "stash-a" });
    expect(store).toHaveBeenCalledWith(opaqueStore);
    await expect(invoke("pi67:prompt-stash-images-store", { ...opaqueStore, path: "/private/image.png" }))
      .rejects.toThrow("store request is invalid");

    await expect(invoke("pi67:prompt-stash-images-restore", { taskId: "task-a", itemId: "stash-a" }))
      .resolves.toMatchObject({ itemId: "stash-a" });
    await expect(invoke("pi67:prompt-stash-images-delete", { taskId: "task-a", itemId: "stash-a" }))
      .resolves.toBeUndefined();
    expect(restore).toHaveBeenCalledWith({ taskId: "task-a", itemId: "stash-a" });
    expect(remove).toHaveBeenCalledWith({ taskId: "task-a", itemId: "stash-a" });
  });
});

function registerFixture(
  inspect: ReturnType<typeof vi.fn>,
  workingTree: { inspect: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn> } | undefined = {
    inspect: vi.fn(),
    detail: vi.fn()
  },
  promptStashImages: {
    store: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  } | undefined = { store: vi.fn(), restore: vi.fn(), delete: vi.fn() },
  repositoryWorktreeActions: {
    initializeSubmodules: ReturnType<typeof vi.fn>;
    recoverAppOwnedWorktree: ReturnType<typeof vi.fn>;
  } = { initializeSubmodules: vi.fn(), recoverAppOwnedWorktree: vi.fn() }
) {
  const activePromptStashImages = promptStashImages ?? { store: vi.fn(), restore: vi.fn(), delete: vi.fn() };
  const activeWorkingTree = workingTree ?? { inspect: vi.fn(), detail: vi.fn() };
  registerSystemBridge({
    connectAgentHost: vi.fn(),
    secureStorage: { ensureAvailable: () => "available" },
    getMainWindow: () => undefined,
    activateMainWindow: async () => undefined,
    desktopToolchain: {},
    desktopCapabilities: {},
    packageNetworkSettings: {},
    promptAttachments: {},
    promptStashImages: {
      ...activePromptStashImages, removeWorkspace: vi.fn(), dispose: vi.fn()
    },
    workbenchState: {},
    workspaceFileState: {},
    repositoryEnvironmentInspection: { inspect, removeWorkspace: vi.fn(), dispose: vi.fn() },
    repositoryWorkingTree: { ...activeWorkingTree, removeWorkspace: vi.fn(), dispose: vi.fn() },
    repositoryWorktreeActions
  } as unknown as Parameters<typeof registerSystemBridge>[0]);
}

async function invoke(channel: string, value?: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler(undefined, value);
}
