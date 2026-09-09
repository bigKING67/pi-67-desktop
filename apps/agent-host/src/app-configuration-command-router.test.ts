import type { PiConfigurationService } from "@pi67/pi-runtime";
import { describe, expect, it, vi } from "vitest";
import { AppConfigurationCommandRouter, isAppConfigurationCommand } from "./app-configuration-command-router.js";

describe("AppConfigurationCommandRouter model discovery", () => {
  it("routes discovery and cancellation without requiring a mutation idempotency key", async () => {
    const result = {
      status: "current" as const,
      models: [],
      families: [{ protocol: "openai" as const, status: "empty" as const, modelCount: 0 }],
      conflicts: [],
      truncated: false
    };
    const discoverGlobalProviderModels = vi.fn(async () => result);
    const cancelGlobalProviderModelDiscovery = vi.fn(() => true);
    const router = new AppConfigurationCommandRouter({
      discoverGlobalProviderModels,
      cancelGlobalProviderModelDiscovery
    } as unknown as PiConfigurationService);
    const input = {
      provider: "gateway",
      baseUrl: "http://127.0.0.1:8317/v1",
      protocols: ["openai" as const],
      openAiApi: "openai-responses" as const,
      apiKey: "router-transient-secret"
    };

    await expect(router.dispatch({
      type: "provider.modelDiscovery.inspect",
      payload: input
    })).resolves.toEqual(result);
    await expect(router.dispatch({
      type: "provider.modelDiscovery.cancel",
      payload: {}
    })).resolves.toEqual({ cancelled: true });

    expect(discoverGlobalProviderModels).toHaveBeenCalledWith(input);
    expect(cancelGlobalProviderModelDiscovery).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("router-transient-secret");
    expect(isAppConfigurationCommand("provider.modelDiscovery.inspect")).toBe(true);
    expect(isAppConfigurationCommand("provider.modelDiscovery.cancel")).toBe(true);
  });
});
