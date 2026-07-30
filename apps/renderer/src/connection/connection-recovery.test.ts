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
    const waitForConnection = vi.spyOn(agentConnectionController, "waitForConnection").mockReturnValue(waiting);

    const first = ensureAgentConnection();
    const second = ensureAgentConnection();
    await Promise.resolve();

    expect(first).toBe(second);
    expect(connectAgentHost).toHaveBeenCalledOnce();
    expect(waitForConnection).toHaveBeenCalledOnce();
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
    const waitForConnection = vi.spyOn(agentConnectionController, "waitForConnection")
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
    expect(waitForConnection).toHaveBeenCalledTimes(2);
  });

  it("forces a same-document replacement after a previous Port was observed", async () => {
    vi.spyOn(agentConnectionController, "hasReceivedPort", "get").mockReturnValue(true);
    vi.spyOn(agentConnectionController, "waitForConnection").mockResolvedValue(identity);

    await expect(ensureAgentConnection()).resolves.toEqual(identity);

    expect(connectAgentHost).toHaveBeenCalledWith({ replaceCurrent: true });
  });
});
