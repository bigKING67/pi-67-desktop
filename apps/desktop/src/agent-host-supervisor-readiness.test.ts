import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, UtilityProcess } from "electron";

const electronMocks = vi.hoisted(() => ({
  fork: vi.fn(),
  MessageChannelMain: class {
    readonly port1 = {};
    readonly port2 = {};
  }
}));

vi.mock("electron", () => ({
  MessageChannelMain: electronMocks.MessageChannelMain,
  utilityProcess: { fork: electronMocks.fork }
}));

import { AgentHostSupervisor } from "./agent-host-supervisor.js";

describe("AgentHostSupervisor readiness", () => {
  beforeEach(() => {
    electronMocks.fork.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not transfer a Port until the current Host emits an exact readiness signal", () => {
    const host = fakeUtilityProcess();
    const window = fakeWindow();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    host.emit("spawn");
    supervisor.connect(true);
    supervisor.attachPort();
    host.emit("message", { type: "agent-host-ready", detail: "not allowed" });

    expect(supervisor.diagnostics()).toMatchObject({ phase: "starting", portHandoffCount: 0 });
    expect(host.postMessage).not.toHaveBeenCalled();
    expect(window.postMessage).not.toHaveBeenCalled();

    host.emit("message", readyMessage());
    host.emit("message", readyMessage());

    expect(supervisor.diagnostics()).toMatchObject({ phase: "running", portHandoffCount: 1 });
    expect(host.postMessage).toHaveBeenCalledOnce();
    expect(window.postMessage).toHaveBeenCalledOnce();
  });

  it("requires readiness from each exact restarted Host", async () => {
    vi.useFakeTimers();
    const firstHost = fakeUtilityProcess();
    const secondHost = fakeUtilityProcess();
    const window = fakeWindow();
    electronMocks.fork
      .mockReturnValueOnce(firstHost as unknown as UtilityProcess)
      .mockReturnValueOnce(secondHost as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    firstHost.emit("spawn");
    firstHost.emit("exit", 1);
    await vi.advanceTimersByTimeAsync(500);
    secondHost.emit("spawn");
    firstHost.emit("message", readyMessage());

    expect(supervisor.diagnostics()).toMatchObject({ phase: "starting", hostEpoch: 2 });
    expect(window.postMessage).not.toHaveBeenCalled();

    secondHost.emit("message", readyMessage());

    expect(supervisor.diagnostics()).toMatchObject({ phase: "running", hostEpoch: 2 });
    expect(window.postMessage).toHaveBeenCalledOnce();
    expect(window.postMessage.mock.calls[0]?.[1]).toMatchObject({ hostEpoch: 2 });
  });

  it("accepts readiness before spawn but waits for OS process authority", () => {
    const host = fakeUtilityProcess();
    const window = fakeWindow();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    host.emit("message", readyMessage());

    expect(supervisor.diagnostics()).toMatchObject({ phase: "starting", portHandoffCount: 0 });
    expect(window.postMessage).not.toHaveBeenCalled();

    host.emit("spawn");

    expect(supervisor.diagnostics()).toMatchObject({ phase: "running", portHandoffCount: 1 });
    expect(window.postMessage).toHaveBeenCalledOnce();
  });

  it("ignores readiness after shutdown begins", () => {
    const host = fakeUtilityProcess();
    const window = fakeWindow();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);

    supervisor.connect();
    host.emit("spawn");
    void supervisor.stop();
    host.emit("message", readyMessage());

    expect(supervisor.diagnostics()).toMatchObject({ phase: "stopping", portHandoffCount: 0 });
    expect(window.postMessage).not.toHaveBeenCalled();
    expect(host.postMessage).toHaveBeenCalledOnce();
    expect(host.postMessage).toHaveBeenCalledWith({
      type: "agent-host-shutdown",
      reason: "application-quit",
      deadlineMs: 3_750
    });
  });
});

function createSupervisor(window: BrowserWindow): AgentHostSupervisor {
  return new AgentHostSupervisor({
    agentHostEntry: "/app/agent-host.mjs",
    appInstanceId: "app-1",
    expectedRendererOrigin: "app://pi67",
    getStoragePaths: () => ({
      storageRoot: "/private/user-data",
      capabilityProbeDirectory: "/private/user-data",
      sessionCatalogDirectory: "/private/user-data/projections/session-catalog"
    }),
    getMainWindow: () => window,
    rendererUrl: "app://pi67/index.html"
  });
}

function fakeWindow() {
  const postMessage = vi.fn();
  return {
    postMessage,
    value: {
      isDestroyed: () => false,
      webContents: {
        id: 7,
        mainFrame: { processId: 11, routingId: 22 },
        isDestroyed: () => false,
        getURL: () => "app://pi67/index.html",
        postMessage,
        send: vi.fn()
      }
    } as unknown as BrowserWindow
  };
}

function fakeUtilityProcess() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    postMessage: vi.fn(),
    kill: vi.fn(),
    stdout: undefined,
    stderr: undefined,
    on(event: string, listener: (...args: unknown[]) => void) {
      const eventListeners = listeners.get(event) ?? [];
      eventListeners.push(listener);
      listeners.set(event, eventListeners);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    }
  };
}

function readyMessage() {
  return {
    type: "agent-host-ready",
    startup: { profileMode: "fresh", status: "ready", issues: [] }
  };
}
