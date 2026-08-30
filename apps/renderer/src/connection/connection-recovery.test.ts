import type { AgentConnectionIdentity } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "./AgentConnectionController.js";
import { ensureAgentConnection } from "./connection-recovery.js";

const identity: AgentConnectionIdentity = {
  appInstanceId: "app-1",
  hostInstanceId: "host-1",
  hostEpoch: 4,
  sdkVersion: "0.81.1",
  eventSequence: 0
};

describe("connection recovery", () => {
  let originalWindow: PropertyDescriptor | undefined;
  let connectAgentHost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    connectAgentHost = vi.fn(async () => undefined);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { pi67: { system: { connectAgentHost } } }
    });
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  it("shares one Port renewal flight across concurrent callers", async () => {
    let resolveConnection!: (value: AgentConnectionIdentity) => void;
    const waiting = new Promise<AgentConnectionIdentity>((resolve) => {
      resolveConnection = resolve;
    });
    vi.spyOn(agentConnectionController, "connectionGeneration", "get").mockReturnValue(3);
    const waitForConnectionAfter = vi.spyOn(agentConnectionController, "waitForConnectionAfter")
      .mockReturnValue(waiting);

    const first = ensureAgentConnection();
    const second = ensureAgentConnection();
    await vi.waitFor(() => {
      expect(waitForConnectionAfter).toHaveBeenCalledOnce();
    });

    expect(first).toBe(second);
    expect(connectAgentHost).toHaveBeenCalledOnce();
    expect(waitForConnectionAfter).toHaveBeenCalledWith(3, 8_000);
    resolveConnection(identity);
    await expect(first).resolves.toEqual(identity);
  });

  it("waits for an already handed-off Port before requesting another one", async () => {
    vi.spyOn(agentConnectionController, "hasOpenPort", "get").mockReturnValue(true);
    const waitForConnection = vi.spyOn(agentConnectionController, "waitForConnection").mockResolvedValue(identity);

    await expect(ensureAgentConnection()).resolves.toEqual(identity);

    expect(waitForConnection).toHaveBeenCalledOnce();
    expect(connectAgentHost).not.toHaveBeenCalled();
  });

  it("retries a failed Port handoff without creating parallel reconnect loops", async () => {
    vi.useFakeTimers();
    vi.spyOn(agentConnectionController, "connectionGeneration", "get")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1);
    const waitForConnectionAfter = vi.spyOn(agentConnectionController, "waitForConnectionAfter")
      .mockRejectedValueOnce(new Error("old Port closed"))
      .mockResolvedValueOnce(identity);

    const first = ensureAgentConnection();
    const second = ensureAgentConnection();
    await vi.runAllTimersAsync();

    await expect(first).resolves.toEqual(identity);
    await expect(second).resolves.toEqual(identity);
    expect(connectAgentHost).toHaveBeenCalledTimes(2);
    expect(connectAgentHost).toHaveBeenNthCalledWith(1, { replaceCurrent: false });
    expect(connectAgentHost).toHaveBeenNthCalledWith(2, { replaceCurrent: false });
    expect(waitForConnectionAfter).toHaveBeenNthCalledWith(1, 0, 8_000);
    expect(waitForConnectionAfter).toHaveBeenNthCalledWith(2, 1, 8_000);
  });

  it("uses a Port handed off during the retry delay without replacing it", async () => {
    vi.useFakeTimers();
    let hasOpenPort = false;
    vi.spyOn(agentConnectionController, "hasOpenPort", "get").mockImplementation(() => hasOpenPort);
    vi.spyOn(agentConnectionController, "connectionGeneration", "get").mockReturnValue(0);
    const waitForConnectionAfter = vi.spyOn(agentConnectionController, "waitForConnectionAfter")
      .mockRejectedValueOnce(new Error("initial handoff timed out"));
    const waitForConnection = vi.spyOn(agentConnectionController, "waitForConnection")
      .mockResolvedValueOnce(identity);

    const connection = ensureAgentConnection();
    await vi.advanceTimersByTimeAsync(0);

    expect(connectAgentHost).toHaveBeenCalledOnce();
    expect(waitForConnectionAfter).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);

    hasOpenPort = true;
    await vi.runAllTimersAsync();

    await expect(connection).resolves.toEqual(identity);
    expect(connectAgentHost).toHaveBeenCalledOnce();
    expect(connectAgentHost).toHaveBeenCalledWith({ replaceCurrent: false });
    expect(waitForConnectionAfter).toHaveBeenCalledOnce();
    expect(waitForConnection).toHaveBeenCalledOnce();
  });

  it("forces a same-document replacement after a previous Port was observed", async () => {
    vi.spyOn(agentConnectionController, "hasReceivedPort", "get").mockReturnValue(true);
    vi.spyOn(agentConnectionController, "connectionGeneration", "get").mockReturnValue(7);
    const waitForConnectionAfter = vi.spyOn(agentConnectionController, "waitForConnectionAfter")
      .mockResolvedValue(identity);

    await expect(ensureAgentConnection()).resolves.toEqual(identity);

    expect(connectAgentHost).toHaveBeenCalledWith({ replaceCurrent: true });
    expect(waitForConnectionAfter).toHaveBeenCalledWith(7, 8_000);
  });

  it("stops before another same-document replacement when short-lived connections opened the circuit", async () => {
    vi.spyOn(agentConnectionController, "hasReceivedPort", "get").mockReturnValue(true);
    const assertReplacement = vi.spyOn(agentConnectionController, "assertAutomaticReplacementAllowed")
      .mockImplementation(() => {
        throw new Error("Pi 运行服务连接反复中断，已停止自动重连以避免界面持续闪烁。");
      });

    await expect(ensureAgentConnection()).rejects.toThrow(/停止自动重连/u);

    expect(assertReplacement).toHaveBeenCalledOnce();
    expect(connectAgentHost).not.toHaveBeenCalled();
  });
});
