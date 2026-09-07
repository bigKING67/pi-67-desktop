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

describe("Workspace removal cleanup", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.ipcHandle.mockReset();
    mocks.ipcHandle.mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    });
  });

  it.each([0, 1, 2, 3, 4])("runs every cleanup and reports failure at step %s", async (failed) => {
    const { remove, cleanups } = fixture();
    cleanups[failed]!.mockRejectedValueOnce(new Error("cleanup failed"));
    const failure = await remove().catch((error: unknown) => error);
    for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledWith("workspace-a");
    expect(failure).toBeInstanceOf(AggregateError);
    await expect(remove()).resolves.toMatchObject({ workspaces: [] });
    for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("reports all failures, including synchronous cleanup failures", async () => {
    const { remove, cleanups } = fixture();
    const first = new Error("draft failed");
    const last = new Error("snapshot failed");
    cleanups[0]!.mockRejectedValueOnce(first);
    cleanups[4]!.mockImplementationOnce(() => { throw last; });
    await expect(remove()).rejects.toMatchObject({ errors: [first, last] });
    for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledOnce();
  });

  it("waits for each cleanup to settle before starting the next", async () => {
    const { remove, cleanups } = fixture();
    let release!: () => void;
    cleanups[0]!.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    }));
    const pending = remove();
    await vi.waitFor(() => expect(cleanups[0]).toHaveBeenCalledOnce());
    for (const cleanup of cleanups.slice(1)) expect(cleanup).not.toHaveBeenCalled();
    release();
    await pending;
    for (const [index, cleanup] of cleanups.entries()) {
      expect(cleanup).toHaveBeenCalledOnce();
      if (index > 0) expect(cleanup.mock.invocationCallOrder[0]).toBeGreaterThan(cleanups[index - 1]!.mock.invocationCallOrder[0]!);
    }
  });

  it("does not clean anything when Registry removal fails", async () => {
    const { remove, cleanups, update } = fixture();
    update.mockRejectedValueOnce(new Error("Registry write failed"));
    await expect(remove()).rejects.toThrow("Registry write failed");
    for (const cleanup of cleanups) expect(cleanup).not.toHaveBeenCalled();
  });
});

function fixture() {
  const cleanups = Array.from({ length: 5 }, () => vi.fn(async () => undefined));
  const update = vi.fn(async () => ({ workspaces: [] }));
  registerSystemBridge({
    connectAgentHost: vi.fn(), secureStorage: { ensureAvailable: () => "available" },
    getMainWindow: () => undefined, activateMainWindow: async () => undefined,
    desktopToolchain: {}, desktopCapabilities: {}, packageNetworkSettings: {}, promptAttachments: {},
    workbenchState: { update },
    composerDraftState: { removeWorkspace: cleanups[0] },
    promptStashImages: { removeWorkspace: cleanups[1] },
    workspaceFileState: { removeWorkspace: cleanups[2] },
    repositoryEnvironmentInspection: { removeWorkspace: cleanups[3] },
    repositoryWorkingTree: { removeWorkspace: cleanups[4] }
  } as unknown as Parameters<typeof registerSystemBridge>[0]);
  return { cleanups, update, remove: async () => mocks.handlers.get("pi67:workspace-remove")!(undefined, "workspace-a") };
}
