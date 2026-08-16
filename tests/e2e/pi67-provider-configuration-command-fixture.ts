import type {
  PiProviderConfigurationInput,
  PiProviderConfigurationSnapshot,
  PiProviderConfigurationView
} from "@pi67/protocol";

export type MockProviderConfigurationCommandHandler = (
  mutation: "save" | "remove" | "credential" | "default" | "vision-global" | "vision-project",
  value: PiProviderConfigurationSnapshot,
  payload: Record<string, unknown>,
  persistent?: boolean
) => PiProviderConfigurationSnapshot;

export function installMockProviderConfigurationCommandHandler(): void {
  const testWindow = window as Window & typeof globalThis & {
    __pi67ResolveMockProviderConfigurationCommand?: MockProviderConfigurationCommandHandler;
  };

  function saveProviderConfiguration(
    value: PiProviderConfigurationSnapshot,
    payload: Record<string, unknown>
  ): PiProviderConfigurationSnapshot {
    const provider = payload.provider as PiProviderConfigurationInput;
    const snapshot = structuredClone(value);
    const view: PiProviderConfigurationView = {
      id: provider.id,
      ...(provider.name === undefined ? {} : { name: provider.name }),
      ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
      ...(provider.api === undefined ? {} : { api: provider.api }),
      ...(provider.oauth === undefined ? {} : { oauth: provider.oauth }),
      ...(provider.authHeader === undefined ? {} : { authHeader: provider.authHeader }),
      origin: "models.json",
      configured: false,
      modelsJsonApiKeyConfigured: false,
      headerNames: appliedHeaderNames([], provider.headers),
      models: provider.models.map((model) => ({
        id: model.id,
        ...(model.name === undefined ? {} : { name: model.name }),
        ...(model.api === undefined ? {} : { api: model.api }),
        ...(model.baseUrl === undefined ? {} : { baseUrl: model.baseUrl }),
        input: model.input ?? ["text"],
        reasoning: model.reasoning ?? false,
        ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
        ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
        headerNames: appliedHeaderNames([], model.headers),
        advancedJson: model.advancedJson ?? "{}"
      })),
      modelCount: provider.models.length,
      advancedJson: provider.advancedJson ?? "{}"
    };
    const index = snapshot.providers.findIndex((candidate) => candidate.id === provider.id);
    if (index >= 0) snapshot.providers[index] = view;
    else snapshot.providers.push(view);
    return nextConfigurationRevision(snapshot);
  }

  function removeProviderConfiguration(
    value: PiProviderConfigurationSnapshot,
    payload: Record<string, unknown>
  ): PiProviderConfigurationSnapshot {
    const snapshot = structuredClone(value);
    snapshot.providers = snapshot.providers.filter((provider) => provider.id !== payload.provider);
    return nextConfigurationRevision(snapshot);
  }

  function updateCredentialConfiguration(
    value: PiProviderConfigurationSnapshot,
    payload: Record<string, unknown>,
    persistent: boolean
  ): PiProviderConfigurationSnapshot {
    const snapshot = structuredClone(value);
    const providerId = payload.provider;
    if (typeof providerId !== "string") throw new Error("Provider credential mutation requires a Provider ID.");
    const credentials = snapshot.credentials;
    snapshot.credentials = persistent
      ? [...credentials.filter((credential) => credential.provider !== providerId), {
          provider: providerId,
          type: "api_key"
        }]
      : credentials.filter((credential) => credential.provider !== providerId);
    snapshot.providers = snapshot.providers.map((provider) => {
      if (provider.id !== providerId) return provider;
      const next: PiProviderConfigurationView = { ...provider, configured: persistent };
      if (persistent) next.credentialSource = "stored";
      else delete next.credentialSource;
      return next;
    });
    return nextConfigurationRevision(snapshot);
  }

  function updateDefaultConfiguration(
    value: PiProviderConfigurationSnapshot,
    payload: Record<string, unknown>
  ): PiProviderConfigurationSnapshot {
    const snapshot = structuredClone(value);
    const defaults = snapshot.defaults;
    const selection = typeof payload.provider === "string" && typeof payload.model === "string"
      ? { provider: payload.provider, model: payload.model }
      : undefined;
    if (payload.scope === "global") {
      if (selection) defaults.global = selection;
      else delete defaults.global;
    } else if (selection) defaults.project = selection;
    else delete defaults.project;
    const effective = defaults.project ?? defaults.global;
    if (effective === undefined) delete defaults.effective;
    else defaults.effective = effective;
    return nextConfigurationRevision(snapshot);
  }

  function updateVisionConfiguration(
    value: PiProviderConfigurationSnapshot,
    payload: Record<string, unknown>,
    scope: "global" | "project"
  ): PiProviderConfigurationSnapshot {
    const snapshot = structuredClone(value);
    const selection = typeof payload.provider === "string" && typeof payload.model === "string"
      ? { provider: payload.provider, model: payload.model }
      : undefined;
    if (scope === "global") {
      if (selection) snapshot.vision.global = selection;
      else delete snapshot.vision.global;
    } else if (payload.mode === "model" && selection) {
      snapshot.vision.project = { mode: "model", ...selection };
      snapshot.vision.disabledByProject = false;
    } else if (payload.mode === "disabled") {
      snapshot.vision.project = { mode: "disabled" };
      snapshot.vision.disabledByProject = true;
    } else {
      delete snapshot.vision.project;
      snapshot.vision.disabledByProject = false;
    }
    const effective = snapshot.vision.project?.mode === "model"
      ? { provider: snapshot.vision.project.provider, model: snapshot.vision.project.model }
      : snapshot.vision.project?.mode === "disabled" ? undefined : snapshot.vision.global;
    if (effective) snapshot.vision.effective = effective;
    else delete snapshot.vision.effective;
    return nextConfigurationRevision(snapshot);
  }

  function nextConfigurationRevision(
    snapshot: PiProviderConfigurationSnapshot
  ): PiProviderConfigurationSnapshot {
    const revision = String(snapshot.revision ?? "0");
    const next = (Number.parseInt(revision.slice(-8), 16) + 1).toString(16).padStart(8, "0");
    snapshot.revision = `${"0".repeat(56)}${next}`;
    snapshot.updatedAt = Date.now();
    return snapshot;
  }

  function appliedHeaderNames(existing: string[], value: unknown): string[] {
    const names = new Map(existing.map((name) => [name.toLocaleLowerCase(), name]));
    if (!Array.isArray(value)) return [...names.values()];
    for (const item of value) {
      const mutation = item as Record<string, unknown>;
      if (typeof mutation.name !== "string") continue;
      const canonical = mutation.name.toLocaleLowerCase();
      if (mutation.remove === true) names.delete(canonical);
      else if (mutation.value !== undefined) names.set(canonical, mutation.name);
    }
    return [...names.values()];
  }

  testWindow.__pi67ResolveMockProviderConfigurationCommand = (mutation, value, payload, persistent) => {
    if (mutation === "save") return saveProviderConfiguration(value, payload);
    if (mutation === "remove") return removeProviderConfiguration(value, payload);
    if (mutation === "credential") return updateCredentialConfiguration(value, payload, persistent === true);
    if (mutation === "vision-global") return updateVisionConfiguration(value, payload, "global");
    if (mutation === "vision-project") return updateVisionConfiguration(value, payload, "project");
    return updateDefaultConfiguration(value, payload);
  };
}
