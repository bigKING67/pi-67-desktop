import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerLocalMemorySettingsBridge } from "./local-memory-settings-bridge.js";
import type { LocalMemorySettingsController } from "./local-memory-settings-controller.js";

const mock = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>() }));
vi.mock("electron", () => ({ ipcMain: {
  handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => mock.handlers.set(name, handler),
  removeHandler: (name: string) => mock.handlers.delete(name)
} }));
function fixture() {
  const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: { url: "app://pi67/index.html" } } };
  const controller = { get: vi.fn(async (): Promise<unknown> => ({ status: "unconfigured" })),
    revealKey: vi.fn(async () => "synthetic-secret"),
    save: vi.fn(async (): Promise<unknown> => ({ status: "unconfigured" })) };
  const dispose = registerLocalMemorySettingsBridge(() => window as unknown as BrowserWindow, () => controller as unknown as LocalMemorySettingsController);
  return { window, controller, dispose, event: { sender: window.webContents, senderFrame: window.webContents.mainFrame } };
}
const invoke = (method: string, ...args: unknown[]) => mock.handlers.get(`pi67:local-memory-settings-${method}`)!(...args);
beforeEach(() => mock.handlers.clear());
describe("memory settings private system bridge", () => {
  it("reveals only on demand and rejects a late result after document navigation", async () => {
    const { event, window, controller } = fixture();
    await invoke("get", event); expect(controller.revealKey).not.toHaveBeenCalled();
    expect(await invoke("reveal-key", event, { endpoint: "https://example.invalid" })).toBe("synthetic-secret");
    controller.revealKey.mockImplementationOnce(async () => {
      window.webContents.mainFrame.url = "https://foreign.invalid/";
      return "synthetic-secret";
    });
    await expect(invoke("reveal-key", event, {})).rejects.toThrow("Saved memory key could not be revealed.");
  });
  it("allows only the current trusted main frame and removes both handlers", async () => {
    const { event, controller, dispose } = fixture();
    expect(await invoke("get", event)).toEqual({ status: "unconfigured" });
    await invoke("save", event, { fixture: true });
    expect(controller.save).toHaveBeenCalledWith({ fixture: true });
    dispose(); expect(mock.handlers.size).toBe(0);
  });
  it.each(["window", "frame", "url"])("rejects a foreign %s before touching settings", async (kind) => {
    const { event, window, controller } = fixture();
    if (kind === "window") event.sender = {} as typeof event.sender;
    if (kind === "frame") event.senderFrame = { url: "app://pi67/index.html" };
    if (kind === "url") window.webContents.mainFrame.url = "https://foreign.invalid/";
    await expect(invoke("get", event)).rejects.toThrow(/authorized/u);
    await expect(invoke("save", event, {})).rejects.toThrow(/authorized/u);
    expect(controller.get).not.toHaveBeenCalled(); expect(controller.save).not.toHaveBeenCalled();
  });
  it("sanitizes errors and rejects secret-bearing projections", async () => {
    const { event, controller } = fixture();
    controller.get.mockResolvedValue({ status: "unconfigured", apiKey: "synthetic-secret" });
    await expect(invoke("get", event)).rejects.toThrow("Memory settings are unavailable.");
    controller.save.mockRejectedValue(new Error("synthetic-secret"));
    await expect(invoke("save", event, {})).rejects.toThrow("Memory settings could not be saved. Check configuration and secure storage.");
  });
});
