import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...arguments_: unknown[]) => unknown>(),
  ipcHandle: vi.fn(),
  showSaveDialog: vi.fn(),
  writeFile: vi.fn()
}));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  writeFile: mocks.writeFile
}));

vi.mock("electron", () => ({
  app: { getVersion: vi.fn(() => "0.1.0-alpha.10"), isPackaged: false },
  clipboard: { writeText: vi.fn() },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 1 })),
    showOpenDialog: vi.fn(),
    showSaveDialog: mocks.showSaveDialog
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

import { createEmptyWorkbenchState } from "./workbench-state.js";
import { registerSystemBridge } from "./system-bridge.js";

describe("system bridge recovery diagnostics", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.ipcHandle.mockReset();
    mocks.ipcHandle.mockImplementation((channel: string, handler: (...arguments_: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    });
    mocks.showSaveDialog.mockReset();
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: "/tmp/pi67-diagnostics.json" });
    mocks.writeFile.mockReset();
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it("projects Desktop recovery state and exports a fixed support schema", async () => {
    registerFixture();

    await expect(invoke("pi67:recovery-snapshot")).resolves.toMatchObject({
      previousRunExitStatus: "unclean",
      pendingSessionCreations: 0,
      attachmentStaging: { draftCount: 2, claimedCount: 1 }
    });
    await expect(invoke("pi67:save-diagnostics", runtimeDiagnostics)).resolves.toBe("/tmp/pi67-diagnostics.json");

    const serialized = mocks.writeFile.mock.calls[0]?.[1];
    expect(typeof serialized).toBe("string");
    expect(JSON.parse(serialized as string)).toEqual(expect.objectContaining({
      schema: "pi67-support-diagnostics.v1",
      application: expect.objectContaining({ version: "0.1.0-alpha.10" }),
      desktop: expect.objectContaining({ previousRunExitStatus: "unclean" }),
      runtime: runtimeDiagnostics
    }));
  });

  it("rejects Renderer-supplied raw paths before opening the save dialog", async () => {
    registerFixture();

    await expect(invoke("pi67:save-diagnostics", {
      ...runtimeDiagnostics,
      cwd: "/private/workspace"
    })).rejects.toThrow("Invalid diagnostic payload.");

    expect(mocks.showSaveDialog).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});

const runtimeDiagnostics = {
  generatedAt: 3,
  application: "π",
  piSdkVersion: "0.81.1",
  platform: "darwin",
  architecture: "arm64",
  node: "24.18.0",
  sessionConfigured: false,
  sessionFileConfigured: false,
  extensionCount: 0,
  extensionErrors: []
};

function registerFixture(): void {
  const state = createEmptyWorkbenchState();
  registerSystemBridge({
    connectAgentHost: vi.fn(),
    getMainWindow: () => undefined,
    activateMainWindow: async () => undefined,
    desktopToolchain: {},
    desktopCapabilities: {},
    packageNetworkSettings: {},
    teamMcpSettings: {},
    promptAttachments: {
      diagnostics: vi.fn(async () => ({
        draftCount: 2,
        claimedCount: 1,
        invalidEntryCount: 0,
        truncated: false
      }))
    },
    previousRunExit: "unclean",
    workbenchState: { load: vi.fn(async () => ({ state })) },
    workspaceFileState: {}
  } as unknown as Parameters<typeof registerSystemBridge>[0]);
}

async function invoke(channel: string, value?: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler(undefined, value);
}
