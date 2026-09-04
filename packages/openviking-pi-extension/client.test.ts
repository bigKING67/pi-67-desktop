import { afterEach, describe, expect, it, vi } from "vitest";
import { OVClient } from "./client.js";
import type { OVConfig } from "./config.js";

describe("OVClient connection authority", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses one recoverable state machine with a bounded health retry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok", result: { status: "ok" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const client = new OVClient(config());
    const transitions: boolean[] = [];
    client.onConnectionChange((connected) => transitions.push(connected));

    await expect(client.ensureConnected(true)).resolves.toBe(false);
    await expect(client.ensureConnected()).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(client.ensureConnected()).resolves.toBe(true);
    expect(client.connected).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(transitions).toEqual([true]);
  });

  it("honors a caller AbortSignal instead of replacing it with only a timeout", async () => {
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      observedSignal = init?.signal ?? undefined;
      observedSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));
    const client = new OVClient(config());
    const controller = new AbortController();
    const request = client.fetchJSON("/api/v1/search/find", { signal: controller.signal }, 10_000);
    controller.abort();

    await expect(request).resolves.toMatchObject({ ok: false, status: 0 });
    expect(observedSignal?.aborted).toBe(true);
  });
});

function config(): OVConfig {
  return {
    enabled: true,
    endpoint: "http://127.0.0.1:1933",
    apiKey: "",
    account: "",
    user: "local-owner",
    peerId: "workspace-peer",
    userAgent: "test",
    healthTimeoutMs: 500,
  } as OVConfig;
}
