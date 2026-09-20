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

  it("projects safe summary timings only for successful managed context transport", async () => {
    const body = { status: "ok", result: { rendered: "synthetic" }, telemetry: {
      id: "do-not-expose", summary: { operation: "search.context", status: "ok", duration_ms: 23,
        errors: { message: "do-not-expose" }, search: { embed_query: { duration_ms: 8 } } }
    } };
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const localProfileId = "00000000-0000-4000-8000-000000000001";
    const managed = new OVClient(config(), { endpoint: "http://127.0.0.1:1933", apiKey: "synthetic-test",
      localProfileId, account: `private-${localProfileId}`, user: "desktop" });
    const result = await managed.fetchJSON("/api/v1/search/search");
    expect(result.contextTiming).toEqual({ durationMs: 23, embedQueryMs: 8 });
    expect(JSON.stringify(result)).not.toContain("do-not-expose");
    expect((await managed.fetchJSON("/health")).contextTiming).toBeUndefined();
    expect((await new OVClient(config()).fetchJSON("/api/v1/search/search")).contextTiming).toBeUndefined();
    fetch.mockImplementation(async () => new Response(JSON.stringify(body), { status: 503 }));
    expect((await managed.fetchJSON("/api/v1/search/search")).contextTiming).toBeUndefined();
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
