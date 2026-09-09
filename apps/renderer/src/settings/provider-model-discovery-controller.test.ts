import type { PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import {
  inspectProviderModelDiscovery,
  saveProviderConfigurationWithCredential
} from "./provider-configuration-controller.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";

describe("Provider model discovery controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useProviderConfigurationStore.getState().reset();
    useNotificationStore.getState().clear();
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({
      appInstanceId: "app",
      hostInstanceId: "host",
      hostEpoch: 2,
      sdkVersion: "fixture",
      eventSequence: 0
    });
  });

  it("keeps discovery read-only and sends a transient key only in the inspect request", async () => {
    const result = {
      status: "current" as const,
      models: [],
      families: [{ protocol: "openai" as const, status: "empty" as const, modelCount: 0 }],
      conflicts: [],
      truncated: false
    };
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(result as never);
    const input = {
      provider: "custom",
      baseUrl: "http://127.0.0.1:8317/v1",
      protocols: ["openai" as const],
      openAiApi: "openai-responses" as const,
      apiKey: "transient-discovery-secret"
    };

    await expect(inspectProviderModelDiscovery(input)).resolves.toBe(result);
    expect(request).toHaveBeenCalledWith(
      "provider.modelDiscovery.inspect",
      input,
      [],
      { context: { scope: "app" }, ackTimeoutMs: 20_000 }
    );
    expect(JSON.stringify(useProviderConfigurationStore.getState())).not.toContain("transient-discovery-secret");
  });

  it("saves a Provider before its optional discovery credential", async () => {
    const initial = snapshot("1");
    const providerSaved = snapshot("2");
    const credentialSaved = snapshot("3", [{ provider: "custom", type: "api_key" }]);
    const store = useProviderConfigurationStore.getState();
    store.beginLoad("app");
    store.install("app", initial);
    store.updateDraft((draft) => ({ ...draft, name: "Updated" }));
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation(async (type) => {
      if (type === "provider.configuration.save") return providerSaved as never;
      if (type === "provider.credential.store") return credentialSaved as never;
      throw new Error(`Unexpected command: ${type}`);
    });

    await expect(saveProviderConfigurationWithCredential(
      "workspace-a",
      "combined-save-secret"
    )).resolves.toBe(true);

    expect(request.mock.calls.map(([type]) => type)).toEqual([
      "provider.configuration.save",
      "provider.credential.store"
    ]);
    expect(request.mock.calls[1]?.[1]).toEqual({
      expectedRevision: providerSaved.revision,
      provider: "custom",
      apiKey: "combined-save-secret"
    });
    expect(JSON.stringify(useProviderConfigurationStore.getState())).not.toContain("combined-save-secret");
  });
});

function snapshot(
  revisionCharacter: string,
  credentials: PiProviderConfigurationSnapshot["credentials"] = []
): PiProviderConfigurationSnapshot {
  return {
    revision: revisionCharacter.repeat(64),
    syncState: "current",
    updatedAt: 1,
    providers: [{
      id: "custom",
      name: "Custom",
      origin: "models.json",
      configured: credentials.length > 0,
      modelsJsonApiKeyConfigured: false,
      headerNames: [],
      models: [{
        id: "model-a",
        input: ["text"],
        reasoning: false,
        headerNames: [],
        advancedJson: "{}"
      }],
      modelCount: 1,
      advancedJson: "{}"
    }],
    credentials,
    defaults: { projectTrusted: true },
    vision: { disabledByProject: false, projectTrusted: true },
    files: ["models", "auth", "global-settings", "project-settings"].map((kind) => ({
      kind: kind as PiProviderConfigurationSnapshot["files"][number]["kind"],
      path: `/fixture/${kind}.json`,
      exists: true,
      valid: true
    })),
    diagnostics: []
  };
}
