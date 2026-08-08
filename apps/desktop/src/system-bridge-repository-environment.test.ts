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
});

function registerFixture(inspect: ReturnType<typeof vi.fn>) {
  registerSystemBridge({
    connectAgentHost: vi.fn(),
    getMainWindow: () => undefined,
    activateMainWindow: async () => undefined,
    desktopToolchain: {},
    desktopCapabilities: {},
    packageNetworkSettings: {},
    teamMcpSettings: {},
    promptAttachments: {},
    workbenchState: {},
    workspaceFileState: {},
    repositoryEnvironmentInspection: { inspect, removeWorkspace: vi.fn(), dispose: vi.fn() }
  } as unknown as Parameters<typeof registerSystemBridge>[0]);
}

async function invoke(channel: string, value?: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler(undefined, value);
}
