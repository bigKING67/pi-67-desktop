import type { AgentConnectionIdentity } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { ensureRendererSessionCreationAuthority } from "./session-creation-authority.js";

vi.mock("../connection/connection-recovery.js", () => ({
  ensureAgentConnection: vi.fn()
}));

const ensureConnection = vi.mocked(ensureAgentConnection);

describe("Renderer Session creation authority", () => {
  beforeEach(() => {
    vi.useRealTimers();
    ensureConnection.mockReset().mockResolvedValue(connectionIdentity(7));
    useAppStore.setState(useAppStore.getInitialState(), true);
  });

  afterEach(() => vi.useRealTimers());

  it("resolves immediately when the matching Renderer authority is current", async () => {
    useAppStore.setState(connectedState(7));

    await expect(ensureRendererSessionCreationAuthority()).resolves.toBeUndefined();
    expect(ensureConnection).toHaveBeenCalledOnce();
  });

  it("waits until connection recovery commits the matching Renderer authority", async () => {
    useAppStore.setState({
      ...connectedState(7),
      sessionTransitionPending: true
    });

    let settled = false;
    const authority = ensureRendererSessionCreationAuthority().then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(ensureConnection).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    useAppStore.setState({ sessionTransitionPending: false });
    await authority;
    expect(settled).toBe(true);
  });

  it("waits until the initial Workspace Catalog admits Session creation", async () => {
    useAppStore.setState({
      ...connectedState(7),
      workspaceOpenPending: true
    });

    let settled = false;
    const authority = ensureRendererSessionCreationAuthority().then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(ensureConnection).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    useAppStore.setState({ workspaceOpenPending: false });
    await authority;
    expect(settled).toBe(true);
  });

  it("does not accept a connected state from a stale Host epoch", async () => {
    useAppStore.setState(connectedState(6));

    let settled = false;
    const authority = ensureRendererSessionCreationAuthority().then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(ensureConnection).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    useAppStore.setState(connectedState(7));
    await authority;
    expect(settled).toBe(true);
  });

  it("propagates connection establishment failures without creating authority", async () => {
    ensureConnection.mockRejectedValueOnce(new Error("connection failed"));

    await expect(ensureRendererSessionCreationAuthority()).rejects.toThrow("connection failed");
  });

  it("bounds connection establishment instead of waiting for the full reconnect retry ladder", async () => {
    vi.useFakeTimers();
    ensureConnection.mockReturnValueOnce(new Promise<AgentConnectionIdentity>(() => undefined));

    const authority = ensureRendererSessionCreationAuthority();
    const rejection = expect(authority).rejects.toThrow("Pi 运行服务连接超时，请稍候后重试。");
    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
  });
});

function connectedState(hostEpoch: number) {
  return {
    connected: true,
    hostEpoch,
    connectionIdentity: connectionIdentity(hostEpoch),
    sessionTransitionPending: false
  };
}

function connectionIdentity(hostEpoch: number): AgentConnectionIdentity {
  return {
    appInstanceId: "app-1",
    hostInstanceId: `host-${hostEpoch}`,
    hostEpoch,
    sdkVersion: "0.81.1",
    eventSequence: 0
  };
}
