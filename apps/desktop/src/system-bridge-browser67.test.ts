import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...arguments_: unknown[]) => unknown>(),
  clipboardWriteText: vi.fn(),
  showItemInFolder: vi.fn(),
  showMessageBox: vi.fn(async () => ({ response: 1 })),
  ipcHandle: vi.fn(),
  openBrowser67ExtensionPage: vi.fn(async () => true)
}));

vi.mock("electron", () => ({
  app: { getVersion: vi.fn(() => "0.1.0"), isPackaged: false },
  clipboard: { writeText: electronMocks.clipboardWriteText },
  dialog: {
    showMessageBox: electronMocks.showMessageBox,
    showOpenDialog: vi.fn()
  },
  ipcMain: {
    handle: electronMocks.ipcHandle
  },
  Menu: { buildFromTemplate: vi.fn() },
  net: { fetch: vi.fn() },
  Notification: class {},
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: electronMocks.showItemInFolder,
    trashItem: vi.fn()
  }
}));

vi.mock("./browser67-integration.js", () => ({
  openBrowser67ExtensionPage: electronMocks.openBrowser67ExtensionPage
}));

import { registerSystemBridge } from "./system-bridge.js";

describe("system bridge browser67 extension IPC", () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.clipboardWriteText.mockReset();
    electronMocks.showItemInFolder.mockReset();
    electronMocks.showMessageBox.mockReset();
    electronMocks.showMessageBox.mockResolvedValue({ response: 1 });
    electronMocks.openBrowser67ExtensionPage.mockReset();
    electronMocks.openBrowser67ExtensionPage.mockResolvedValue(true);
    electronMocks.ipcHandle.mockReset();
    electronMocks.ipcHandle.mockImplementation((channel: string, handler: (...arguments_: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler);
    });
  });

  it("rejects invalid browser and verification payloads at the Main boundary", async () => {
    const fixture = registerFixture();
    await expect(invoke("pi67:browser67-extension-open-browser", "firefox"))
      .rejects.toThrow("Browser selection is invalid.");
    await expect(invoke("pi67:browser67-extension-verify", { startHub: "yes" }))
      .rejects.toThrow("browser67 verification options are invalid.");
    await expect(invoke("pi67:browser67-extension-verify", { startHub: true, path: "/tmp/escape" }))
      .rejects.toThrow("browser67 verification options are invalid.");
    expect(electronMocks.openBrowser67ExtensionPage).not.toHaveBeenCalled();
    expect(fixture.desktopCapabilities.verifyBrowser67Extension).not.toHaveBeenCalled();
  });

  it("does not mutate extension state when native prepare or Hub confirmation is canceled", async () => {
    const fixture = registerFixture();
    await expect(invoke("pi67:browser67-extension-prepare")).resolves.toEqual({ phase: "ready" });
    await expect(invoke("pi67:browser67-extension-verify", { startHub: true }))
      .resolves.toEqual({ phase: "ready" });
    expect(fixture.desktopCapabilities.prepareBrowser67Extension).not.toHaveBeenCalled();
    expect(fixture.desktopCapabilities.verifyBrowser67Extension).not.toHaveBeenCalled();
    expect(fixture.desktopCapabilities.snapshot).toHaveBeenCalledTimes(2);
  });

  it("opens only a validated browser id", async () => {
    registerFixture();
    await expect(invoke("pi67:browser67-extension-open-browser", "chrome")).resolves.toBe(true);
    expect(electronMocks.openBrowser67ExtensionPage).toHaveBeenCalledWith("chrome");
  });

  it("reveals and copies only after the service verifies the extension manifest", async () => {
    const fixture = registerFixture();
    await expect(invoke("pi67:browser67-extension-reveal")).resolves.toBe(true);
    expect(fixture.desktopCapabilities.browser67ExtensionManifestPath).toHaveBeenCalledOnce();
    expect(electronMocks.showItemInFolder).toHaveBeenCalledWith("/safe/browser67/manifest.json");

    fixture.desktopCapabilities.browser67ExtensionManifestPath.mockClear();
    await expect(invoke("pi67:browser67-extension-copy")).resolves.toBe(true);
    expect(fixture.desktopCapabilities.browser67ExtensionManifestPath).toHaveBeenCalledOnce();
    expect(fixture.desktopCapabilities.browser67ExtensionDirectory).toHaveBeenCalledOnce();
    expect(electronMocks.clipboardWriteText).toHaveBeenCalledWith("/safe/browser67");
    expect(fixture.desktopCapabilities.browser67ExtensionManifestPath.mock.invocationCallOrder[0])
      .toBeLessThan(electronMocks.clipboardWriteText.mock.invocationCallOrder[0]!);
  });
});

function registerFixture() {
  const desktopCapabilities = {
    snapshot: vi.fn(async () => ({ phase: "ready" })),
    setupBrowser67: vi.fn(),
    doctorBrowser67: vi.fn(),
    prepareBrowser67Extension: vi.fn(async () => ({ phase: "ready" })),
    verifyBrowser67Extension: vi.fn(async () => ({ phase: "ready" })),
    browser67ExtensionManifestPath: vi.fn(async () => "/safe/browser67/manifest.json"),
    browser67ExtensionDirectory: vi.fn(() => "/safe/browser67")
  };
  registerSystemBridge({
    connectAgentHost: vi.fn(),
    getMainWindow: () => undefined,
    activateMainWindow: async () => undefined,
    desktopToolchain: {},
    desktopCapabilities,
    packageNetworkSettings: {},
    teamMcpSettings: {},
    promptAttachments: {},
    workbenchState: {},
    workspaceFileState: {}
  } as unknown as Parameters<typeof registerSystemBridge>[0]);
  return { desktopCapabilities };
}

async function invoke(channel: string, value?: unknown): Promise<unknown> {
  const handler = electronMocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler(undefined, value);
}
