import type { BrowserWindow, UtilityProcess } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("AgentHostSupervisor startup failure", () => {
  beforeEach(() => {
    electronMocks.fork.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops restart recovery after one structured deterministic startup failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    const host = fakeUtilityProcess();
    const window = fakeWindow();
    electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
    const supervisor = createSupervisor(window.value);
    const startupFailure = {
      type: "agent-host-startup-failed",
      profileMode: "fresh",
      issue: { stage: "desktop-capabilities", code: "integrity-failure" }
    };

    supervisor.connect();
    host.emit("spawn");
    host.emit("message", startupFailure);
    supervisor.connect();

    expect(window.send).toHaveBeenCalledOnce();
    expect(window.send).toHaveBeenCalledWith("pi67:agent-host-failed", {
      hostEpoch: 1,
      code: 1,
      recoverable: false,
      startupFailure
    });
    expect(supervisor.diagnostics()).toMatchObject({
      phase: "failed",
      lastStartupFailure: {
        at: 20_000,
        hostEpoch: 1,
        profileMode: "fresh",
        issue: { stage: "desktop-capabilities", code: "integrity-failure" }
      }
    });

    host.emit("exit", 1);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(electronMocks.fork).toHaveBeenCalledOnce();
    expect(supervisor.diagnostics()).toMatchObject({
      phase: "failed",
      lastExit: { at: 20_000, code: 1, recoverable: false },
      restartCount: 0
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
  const send = vi.fn();
  return {
    send,
    value: {
      isDestroyed: () => false,
      webContents: {
        id: 7,
        mainFrame: { processId: 11, routingId: 22 },
        isDestroyed: () => false,
        getURL: () => "app://pi67/index.html",
        postMessage: vi.fn(),
        send
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
