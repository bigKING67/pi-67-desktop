import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiModelCatalogRefreshCoordinator, type PiModelCatalogRuntime } from "./pi-model-catalog-refresh.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("PiModelCatalogRefreshCoordinator", () => {
  it("does not enable network when no refreshable Provider is configured", async () => {
    const runtime = fakeRuntime({ configured: false });
    const coordinator = coordinatorFor(runtime);

    await expect(coordinator.refresh(false)).resolves.toEqual({
      status: "unconfigured",
      providers: [],
      failedProviders: []
    });
    expect(runtime.refresh).not.toHaveBeenCalled();
    await coordinator.dispose();
  });

  it("refreshes only configured dynamic Providers with explicit network authority", async () => {
    const runtime = fakeRuntime({
      refreshResult: {
        aborted: false,
        errors: new Map([["deepseek", new Error("unavailable")]])
      }
    });
    const coordinator = coordinatorFor(runtime);

    await expect(coordinator.refresh(true)).resolves.toEqual({
      status: "partial",
      providers: ["deepseek"],
      failedProviders: ["deepseek"]
    });
    expect(runtime.refresh).toHaveBeenCalledWith({
      allowNetwork: true,
      force: true,
      providers: ["deepseek"],
      signal: expect.any(AbortSignal)
    });
    await coordinator.dispose();
  });

  it("shares concurrent automatic refreshes", async () => {
    let settle: ((value: { aborted: boolean; errors: Map<string, Error> }) => void) | undefined;
    const runtime = fakeRuntime({
      refresh: vi.fn<PiModelCatalogRuntime["refresh"]>(() => new Promise((resolve) => { settle = resolve; }))
    });
    const createRuntime = vi.fn(async () => runtime);
    const coordinator = new PiModelCatalogRefreshCoordinator({
      timeoutMs: 15_000,
      createRuntime,
      isOffline: () => false
    });

    const first = coordinator.refresh(false);
    const second = coordinator.refresh(false);
    await vi.waitFor(() => expect(runtime.refresh).toHaveBeenCalledOnce());
    settle?.({ aborted: false, errors: new Map() });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "current", providers: ["deepseek"], failedProviders: [] },
      { status: "current", providers: ["deepseek"], failedProviders: [] }
    ]);
    expect(createRuntime).toHaveBeenCalledOnce();
    await coordinator.dispose();
  });

  it("aborts a bounded refresh and reports cached fallback", async () => {
    vi.useFakeTimers();
    const runtime = fakeRuntime({
      refresh: vi.fn<PiModelCatalogRuntime["refresh"]>((options) => new Promise((resolve) => {
        options?.signal?.addEventListener("abort", () => {
          resolve({ aborted: true, errors: new Map() });
        }, { once: true });
      }))
    });
    const coordinator = coordinatorFor(runtime, 5_000);

    const refresh = coordinator.refresh(false);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(refresh).resolves.toEqual({
      status: "timed-out",
      providers: ["deepseek"],
      failedProviders: []
    });
    expect(runtime.refresh.mock.calls[0]?.[0]?.signal?.aborted).toBe(true);
    await coordinator.dispose();
  });

  it("honors offline mode before creating a runtime", async () => {
    const createRuntime = vi.fn(async () => fakeRuntime());
    const coordinator = new PiModelCatalogRefreshCoordinator({
      timeoutMs: 15_000,
      createRuntime,
      isOffline: () => true
    });

    await expect(coordinator.refresh(false)).resolves.toEqual({
      status: "offline",
      providers: [],
      failedProviders: []
    });
    expect(createRuntime).not.toHaveBeenCalled();
    await coordinator.dispose();
  });
});

function coordinatorFor(runtime: PiModelCatalogRuntime, timeoutMs = 15_000) {
  return new PiModelCatalogRefreshCoordinator({
    timeoutMs,
    createRuntime: async () => runtime,
    isOffline: () => false
  });
}

function fakeRuntime(options: {
  configured?: boolean;
  refresh?: ReturnType<typeof vi.fn<PiModelCatalogRuntime["refresh"]>>;
  refreshResult?: { aborted: boolean; errors: Map<string, Error> };
} = {}) {
  const provider = {
    id: "deepseek",
    name: "DeepSeek",
    auth: {},
    getModels: () => [],
    refreshModels: vi.fn(),
    stream: vi.fn(),
    streamSimple: vi.fn()
  } as unknown as ReturnType<ModelRuntime["getProviders"]>[number];
  return {
    getProviders: () => [provider],
    hasConfiguredAuth: () => options.configured ?? true,
    refresh: options.refresh ?? vi.fn<PiModelCatalogRuntime["refresh"]>(async () => (
      options.refreshResult ?? { aborted: false, errors: new Map() }
    ))
  } satisfies PiModelCatalogRuntime;
}
