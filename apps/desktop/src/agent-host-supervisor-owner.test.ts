import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import type { BrowserWindow, UtilityProcess } from "electron";

const electronMocks = vi.hoisted(() => ({
  fork: vi.fn(),
  MessageChannelMain: class Channel {
    static readonly instances: Channel[] = [];
    readonly port1 = { close: vi.fn() };
    readonly port2 = { close: vi.fn() };
    constructor() { Channel.instances.push(this); }
  }
}));
vi.mock("electron", () => ({ MessageChannelMain: electronMocks.MessageChannelMain, utilityProcess: { fork: electronMocks.fork } }));
import { AgentHostSupervisor } from "./agent-host-supervisor.js";

afterEach(() => {
  electronMocks.fork.mockReset();
  electronMocks.MessageChannelMain.instances.length = 0;
});

function fixture() {
  const host = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() });
  const postMessage = vi.fn();
  const window = { isDestroyed: () => false, webContents: {
    id: 7, mainFrame: { processId: 11, routingId: 22 }, isDestroyed: () => false,
    getURL: () => "app://pi67/index.html", postMessage, send: vi.fn()
  } } as unknown as BrowserWindow;
  electronMocks.fork.mockReturnValue(host as unknown as UtilityProcess);
  const supervisor = new AgentHostSupervisor({
    agentHostEntry: "/app/agent-host.mjs", appInstanceId: "app-1", expectedRendererOrigin: "app://pi67",
    rendererUrl: "app://pi67/index.html", getMainWindow: () => window,
    getStoragePaths: () => ({ storageRoot: "/private/user-data", capabilityProbeDirectory: "/private/user-data",
      sessionCatalogDirectory: "/private/user-data/projections/session-catalog" })
  });
  return { host, postMessage, supervisor };
}

function ready(host: EventEmitter) {
  host.emit("spawn");
  host.emit("message", { type: "agent-host-ready", startup: { profileMode: "fresh", status: "ready", issues: [] } });
}

it("retains ownership across Renderer replacement and shutdown until this exact Host exits", async () => {
  const { host, postMessage, supervisor } = fixture();
  supervisor.connect(); ready(host);
  const owner = electronMocks.MessageChannelMain.instances[0]!;
  expect(host.postMessage).toHaveBeenCalledWith({ type: "agent-host-owner" }, [owner.port2]);
  expect(postMessage.mock.calls[0]?.[2]).not.toContain(owner.port1);
  expect(postMessage.mock.calls[0]?.[2]).not.toContain(owner.port2);
  supervisor.connect(true);
  expect(owner.port1.close).not.toHaveBeenCalled();
  const stopping = supervisor.stop();
  expect(owner.port1.close).not.toHaveBeenCalled();
  host.emit("exit", 0); await stopping;
  expect(owner.port1.close).toHaveBeenCalledOnce();
});

it("kills a Host if owner transfer fails, before Renderer handoff", async () => {
  const { host, postMessage, supervisor } = fixture();
  host.postMessage.mockImplementationOnce(() => { throw new Error("closed parent channel"); });
  supervisor.connect(); ready(host);
  expect(host.kill).toHaveBeenCalledOnce();
  expect(postMessage).not.toHaveBeenCalled();
  const owner = electronMocks.MessageChannelMain.instances[0]!;
  expect(owner.port1.close).toHaveBeenCalledOnce();
  expect(owner.port2.close).toHaveBeenCalledOnce();
  const stopping = supervisor.stop(); host.emit("exit", 1); await stopping;
});
