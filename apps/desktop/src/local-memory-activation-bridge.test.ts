import type { BrowserWindow } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
import { registerLocalMemoryActivationBridge } from "./local-memory-activation-bridge.js";
import type { LocalMemoryActivationController } from "./local-memory-activation-controller.js";
const mock = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock("electron", () => ({ ipcMain: {
  handle: (name: string, handler: (...args: unknown[]) => unknown) => mock.handlers.set(name, handler),
  removeHandler: (name: string) => mock.handlers.delete(name)
} }));
const invoke = async (method: string, ...args: unknown[]) => mock.handlers.get(`pi67:local-memory-activation-${method}`)!(...args);
const snapshot = { available: true, preference: "disabled", selectedAtLaunch: false, restartRequired: false, lifecycle: "idle", issue: "none", busy: false } as const;
function fixture() {
  const contents = { isDestroyed: () => false, mainFrame: { url: "app://pi67/index.html" } };
  const window = { isDestroyed: () => false, webContents: contents };
  const controller = { get: vi.fn(() => snapshot), setEnabled: vi.fn(async (_enabled: boolean) => snapshot),
    check: vi.fn(async () => ({ activation: snapshot, health: "not-running" as const })) };
  const dispose = registerLocalMemoryActivationBridge(() => window as unknown as BrowserWindow, () => controller as unknown as LocalMemoryActivationController);
  return { contents, controller, dispose, event: { sender: contents, senderFrame: contents.mainFrame } };
}
beforeEach(() => { mock.handlers.clear(); });
it("accepts only the explicit boolean request and bounded Main snapshot", async () => {
  const { event, controller, dispose } = fixture();
  expect(await invoke("get", event)).toEqual(snapshot);
  expect(await invoke("check", event)).toEqual({ activation: snapshot, health: "not-running" });
  for (const enabled of [true, false]) {
    expect(await invoke("set", event, { enabled })).toEqual(snapshot);
    expect(controller.setEnabled).toHaveBeenLastCalledWith(enabled);
  }
  dispose(); expect(mock.handlers.size).toBe(0);
});
it.each([[], [true], [{ enabled: "true" }], [{ enabled: true, path: "/foreign" }], [{ enabled: true }, false]])("rejects malformed request %j before mutation", async (...args) => {
  const { event, controller } = fixture();
  await expect(invoke("set", event, ...args)).rejects.toThrow("Invalid");
  await expect(invoke("get", event, true)).rejects.toThrow("Invalid");
  await expect(invoke("check", event, { endpoint: "http://foreign" })).rejects.toThrow("Invalid");
  expect(controller.check).not.toHaveBeenCalled();
  expect(controller.setEnabled).not.toHaveBeenCalled(); expect(controller.get).not.toHaveBeenCalled();
});
it.each(["sender", "frame", "url"])("refuses foreign %s", async (kind) => {
  const { event, controller } = fixture();
  if (kind === "sender") event.sender = {} as typeof event.sender;
  if (kind === "frame") event.senderFrame = { url: "app://pi67/index.html" };
  if (kind === "url") event.senderFrame.url = "https://foreign.invalid";
  await expect(invoke("set", event, { enabled: true })).rejects.toThrow("authorized");
  await expect(invoke("check", event)).rejects.toThrow("authorized");
  expect(controller.check).not.toHaveBeenCalled();
  expect(controller.setEnabled).not.toHaveBeenCalled();
});
it("withholds health after navigation and sanitizes health errors", async () => {
  const { event, controller } = fixture();
  controller.check.mockImplementation(async () => {
    event.senderFrame.url = "https://foreign.invalid";
    return { activation: snapshot, health: "not-running" };
  });
  await expect(invoke("check", event)).rejects.toThrow("Private memory health could not be checked");
  event.senderFrame.url = "app://pi67/index.html";
  controller.check.mockRejectedValue(new Error("secret-path"));
  await expect(invoke("check", event)).rejects.toThrow("Private memory health could not be checked");
});
it("withholds a late reply after navigation and sanitizes internal rejection", async () => {
  const { event, controller } = fixture();
  controller.setEnabled.mockImplementation(async () => { event.senderFrame.url = "https://foreign.invalid"; return snapshot; });
  await expect(invoke("set", event, { enabled: true })).rejects.toThrow("Refresh its status");
  event.senderFrame.url = "app://pi67/index.html";
  controller.setEnabled.mockRejectedValue(new Error("secret-path"));
  await expect(invoke("set", event, { enabled: false })).rejects.toThrow("Refresh its status");
});
