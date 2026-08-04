import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiRuntimeConfigurationReload } from "./pi-runtime-configuration-reload.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("PiRuntimeConfigurationReload", () => {
  it("aborts an offline refresh at its deadline and keeps the revision pending", async () => {
    vi.useFakeTimers();
    const refresh = abortableRefresh();
    const reload = new PiRuntimeConfigurationReload({
      getSession: () => sessionWithRefresh(refresh),
      emit: vi.fn(),
      refreshTimeoutMs: 5_000
    });

    const pending = reload.request("revision-1");
    const outcome = expect(pending).rejects.toMatchObject({
      code: "RUNTIME_NOT_READY",
      recoverable: true
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await outcome;
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({
      allowNetwork: false,
      signal: expect.any(AbortSignal)
    }));
    expect(refresh.mock.calls[0]?.[0].signal?.aborted).toBe(true);
    await reload.dispose();
  });

  it("cancels an older revision before attempting the newest revision", async () => {
    vi.useFakeTimers();
    const refresh = abortableRefresh();
    const reload = new PiRuntimeConfigurationReload({
      getSession: () => sessionWithRefresh(refresh),
      emit: vi.fn(),
      refreshTimeoutMs: 5_000
    });

    const first = reload.request("revision-1");
    const firstOutcome = expect(first).rejects.toMatchObject({ code: "RUNTIME_NOT_READY" });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const second = reload.request("revision-2");
    const secondOutcome = expect(second).rejects.toMatchObject({ code: "RUNTIME_NOT_READY" });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(refresh.mock.calls[0]?.[0].signal?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);
    await firstOutcome;
    await secondOutcome;
    expect(refresh.mock.calls[1]?.[0].signal?.aborted).toBe(true);
    await reload.dispose();
  });

  it("aborts and settles the active refresh during disposal", async () => {
    const refresh = abortableRefresh();
    const reload = new PiRuntimeConfigurationReload({
      getSession: () => sessionWithRefresh(refresh),
      emit: vi.fn(),
      refreshTimeoutMs: 60_000
    });

    const pending = reload.request("revision-1");
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await reload.dispose();

    await expect(pending).resolves.toBe("applied");
    expect(refresh.mock.calls[0]?.[0].signal?.aborted).toBe(true);
  });
});

function abortableRefresh() {
  return vi.fn((options: { signal?: AbortSignal }) => new Promise<{
    aborted: boolean;
    errors: Map<string, Error>;
  }>((resolve) => {
    options.signal?.addEventListener("abort", () => {
      resolve({ aborted: true, errors: new Map() });
    }, { once: true });
  }));
}

function sessionWithRefresh(refresh: ReturnType<typeof abortableRefresh>): AgentSession {
  return {
    isIdle: true,
    model: undefined,
    modelRuntime: { refresh }
  } as unknown as AgentSession;
}
