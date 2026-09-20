import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerLocalMemoryRuntimeBridge } from "./local-memory-runtime-bridge.js";
import type { LocalMemoryRuntimeController } from "./local-memory-runtime-controller.js";
const mock = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), picker: vi.fn() }));
vi.mock("electron", () => ({ dialog: { showOpenDialog: mock.picker }, ipcMain: {
  handle: (name: string, handler: (...args: unknown[]) => unknown) => mock.handlers.set(name, handler),
  removeHandler: (name: string) => mock.handlers.delete(name)
} }));
const invoke = async (method: string, ...args: unknown[]) => mock.handlers.get(`pi67:local-memory-runtime-${method}`)!(...args);
function fixture() {
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: { url: "app://pi67/index.html" } });
  const window = { isDestroyed: () => false, webContents: contents };
  const controller = { getStatus: vi.fn(async () => "missing"), install: vi.fn(async (_source: string, _signal: AbortSignal) => undefined) };
  const dispose = registerLocalMemoryRuntimeBridge(() => window as unknown as BrowserWindow, () => controller as unknown as LocalMemoryRuntimeController);
  return { controller, contents, dispose, event: { sender: contents, senderFrame: contents.mainFrame } };
}
beforeEach(() => { mock.handlers.clear(); mock.picker.mockReset(); mock.picker.mockResolvedValue({ canceled: false, filePaths: ["/native-selected"] }); });
describe("runtime installer private bridge", () => {
  it("accepts source only from the Main-owned picker and returns a path-free result", async () => {
    const { event, controller } = fixture();
    expect(await invoke("status", event)).toBe("missing");
    expect(await invoke("install", event)).toBe("installed");
    expect(controller.getStatus).toHaveBeenCalledWith("private");
    expect(controller.install).toHaveBeenCalledWith("/native-selected", expect.any(AbortSignal), "private");
    await expect(invoke("install", event, { source: "/renderer-path" })).rejects.toThrow("authorized");
  });
  it.each(["private", "team-index-v1", "team-query-v1"])("forwards only the selected %s purpose", async (purpose) => {
    const { event, controller } = fixture();
    expect(await invoke("status", event, purpose)).toBe("missing");
    expect(controller.getStatus).toHaveBeenCalledWith(purpose);
    expect(await invoke("install", event, purpose)).toBe("installed");
    expect(controller.install).toHaveBeenCalledWith("/native-selected", expect.any(AbortSignal), purpose);
  });
  it.each([[null], [undefined], ["team"], ["/renderer/path"], [{ purpose: "private" }], ["private", "team-index-v1"]])("rejects malformed arguments %j before any operation", async (...args) => {
    const { event, controller } = fixture();
    for (const method of ["status", "install", "cancel"]) await expect(invoke(method, event, ...args)).rejects.toThrow("authorized");
    expect(mock.picker).not.toHaveBeenCalled(); expect(controller.install).not.toHaveBeenCalled(); expect(controller.getStatus).not.toHaveBeenCalled();
  });
  it.each(["sender", "frame", "url"])("rejects foreign %s without opening a dialog", async (kind) => {
    const { event } = fixture();
    if (kind === "sender") event.sender = {} as typeof event.sender;
    if (kind === "frame") event.senderFrame = { url: "app://pi67/index.html" };
    if (kind === "url") event.senderFrame.url = "https://foreign.invalid";
    await expect(invoke("install", event)).rejects.toThrow("authorized"); expect(mock.picker).not.toHaveBeenCalled();
  });
  it("serializes picker calls and cancels before touching the selected source", async () => {
    const { event, controller } = fixture();
    let resolve!: (value: unknown) => void;
    mock.picker.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const operation = invoke("install", event);
    expect(await invoke("install", event, "team-index-v1")).toBe("busy");
    expect(await invoke("install", event, "team-query-v1")).toBe("busy");
    await invoke("cancel", event); resolve({ canceled: false, filePaths: ["/native-selected"] });
    expect(await operation).toBe("cancelled"); expect(controller.install).not.toHaveBeenCalled();
  });
  it.each(["destroyed", "render-process-gone", "did-start-navigation"])("aborts work on %s", async (eventName) => {
    const { event, contents, controller, dispose } = fixture();
    controller.install.mockImplementation(async (_source, signal) => {
      contents.emit(eventName); signal.throwIfAborted();
    });
    expect(await invoke("install", event)).toBe("cancelled");
    expect(contents.listenerCount(eventName)).toBe(0); dispose(); expect(mock.handlers.size).toBe(0);
  });
  it("treats picker cancellation as a no-op and sanitizes installer errors", async () => {
    const { event, controller } = fixture();
    mock.picker.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await invoke("install", event)).toBe("cancelled"); expect(controller.install).not.toHaveBeenCalled();
    controller.install.mockRejectedValue(new Error("private-path-and-secret"));
    expect(await invoke("install", event)).toBe("failed");
  });
});
