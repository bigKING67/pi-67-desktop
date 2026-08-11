import {
  createAgentSessionServices,
  type AgentSessionServices,
  type ModelRuntime,
  type SettingsManager
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createPiWorkspaceProviderCatalog } from "./workspace-provider-catalog.js";

describe("Pi Workspace Provider catalog", () => {
  it("installs first-party Providers before projecting a Session-free catalog", async () => {
    const providers = [{ id: "anthropic", name: "Anthropic" }];
    const models: Array<Record<string, unknown> & { provider: string }> = [];
    const runtimeShape = {
      refresh: vi.fn(async () => undefined),
      registerProvider: vi.fn((providerId: string, registration: {
        name?: string;
        models: ReadonlyArray<Record<string, unknown>>;
      }) => {
        providers.push({ id: providerId, name: registration.name ?? providerId });
        models.push(...registration.models.map((model) => ({ ...model, provider: providerId })));
        void runtimeShape.refresh();
      }),
      getProviders: () => providers,
      getModels: () => models,
      getProviderAuthStatus: () => ({ configured: false }),
      setRuntimeApiKey: vi.fn()
    };
    const createServices = vi.fn(async () => ({
      modelRuntime: runtimeShape as unknown as ModelRuntime
    }) as AgentSessionServices);
    const catalog = createPiWorkspaceProviderCatalog({
      cwd: "/workspace",
      agentDir: "/agent",
      settingsManager: {} as SettingsManager,
      createServices: createServices as typeof createAgentSessionServices
    });

    await expect(catalog.list()).resolves.toContainEqual(expect.objectContaining({
      id: "groland",
      label: "Groland",
      configured: false,
      modelCount: 7
    }));
    await catalog.list();
    expect(runtimeShape.registerProvider).toHaveBeenCalledTimes(1);
    await catalog.dispose();
  });
});
