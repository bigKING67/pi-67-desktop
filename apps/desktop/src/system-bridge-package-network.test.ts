import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...arguments_: unknown[]) => unknown>(),
  ipcHandle: vi.fn(),
  probePackageSources: vi.fn()
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

vi.mock("./package-source-probe.js", () => ({
  probePackageSources: mocks.probePackageSources,
  unprobedPackageNetworkSnapshot: vi.fn()
}));

import { registerSystemBridge } from "./system-bridge.js";

describe("system bridge package network probe", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.ipcHandle.mockReset();
    mocks.ipcHandle.mockImplementation((channel: string, handler: (...arguments_: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    });
    mocks.probePackageSources.mockReset();
    mocks.probePackageSources.mockImplementation(async ({ settings }: { settings: unknown }) => ({
      settings,
      toolchain: { ready: true },
      sources: [],
      checkedAt: 123
    }));
  });

  it("probes a validated draft without reading or writing the settings store", async () => {
    const packageNetworkSettings = registerFixture();
    const settings = {
      npmMode: "custom",
      npmCustomRegistry: "https://registry.example.com",
      gitMode: "official-only",
      gitMirrors: []
    };

    await expect(invoke("pi67:package-network-probe", settings)).resolves.toMatchObject({
      settings,
      checkedAt: 123
    });
    expect(packageNetworkSettings.load).not.toHaveBeenCalled();
    expect(packageNetworkSettings.save).not.toHaveBeenCalled();
    expect(packageNetworkSettings.reset).not.toHaveBeenCalled();
    expect(mocks.probePackageSources).toHaveBeenCalledWith(expect.objectContaining({ settings }));
  });

  it("rejects an invalid draft before starting network work", async () => {
    const packageNetworkSettings = registerFixture();

    await expect(invoke("pi67:package-network-probe", {
      npmMode: "custom",
      npmCustomRegistry: "http://localhost:4873",
      gitMode: "automatic",
      gitMirrors: ["gitclone"]
    })).rejects.toThrow("Package network settings are invalid.");

    expect(mocks.probePackageSources).not.toHaveBeenCalled();
    expect(packageNetworkSettings.load).not.toHaveBeenCalled();
    expect(packageNetworkSettings.save).not.toHaveBeenCalled();
  });
});

function registerFixture() {
  const packageNetworkSettings = {
    load: vi.fn(),
    save: vi.fn(),
    reset: vi.fn()
  };
  registerSystemBridge({
    connectAgentHost: vi.fn(),
    getMainWindow: () => undefined,
    desktopToolchain: {},
    desktopCapabilities: {},
    packageNetworkSettings,
    teamMcpSettings: {},
    promptAttachments: {},
    workbenchState: {},
    workspaceFileState: {}
  } as unknown as Parameters<typeof registerSystemBridge>[0]);
  return packageNetworkSettings;
}

async function invoke(channel: string, value?: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return handler(undefined, value);
}
