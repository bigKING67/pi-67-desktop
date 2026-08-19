import {
  createAgentSessionServices,
  type AgentSessionServices,
  type SettingsManager
} from "@earendil-works/pi-coding-agent";
import { RuntimeError, type ProviderSummary } from "@pi67/domain";
import {
  createRuntimeCredentialOverrideStore,
  type RuntimeCredentialOverrideStore
} from "./runtime-credential-overrides.js";
import { installFirstPartyModelProviders } from "./first-party-model-providers.js";
import { projectRuntimeProviders } from "./session-snapshot.js";

export interface CreatePiWorkspaceProviderCatalogOptions {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
  runtimeCredentialOverrides?: RuntimeCredentialOverrideStore;
  createServices?: typeof createAgentSessionServices;
}

export interface PiWorkspaceProviderCatalog {
  list(): Promise<ProviderSummary[]>;
  dispose(): Promise<void>;
}

/** Lazily projects Pi Provider state without creating a Session or Task Runtime. */
export function createPiWorkspaceProviderCatalog(
  options: CreatePiWorkspaceProviderCatalogOptions
): PiWorkspaceProviderCatalog {
  const runtimeCredentialOverrides = options.runtimeCredentialOverrides
    ?? createRuntimeCredentialOverrideStore();
  const ownsRuntimeCredentialOverrides = options.runtimeCredentialOverrides === undefined;
  const createServices = options.createServices ?? createAgentSessionServices;
  let servicesLoad: Promise<AgentSessionServices> | undefined;
  let unsubscribe: (() => void) | undefined;
  let disposed = false;

  const load = (): Promise<AgentSessionServices> => {
    if (disposed) return Promise.reject(disposedError());
    servicesLoad ??= createServices({
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager: options.settingsManager
    }).then(async (services) => {
      if (disposed) throw disposedError();
      await installFirstPartyModelProviders(services.modelRuntime);
      unsubscribe = runtimeCredentialOverrides.subscribe((provider, apiKey) => (
        services.modelRuntime.setRuntimeApiKey(provider, apiKey)
      ));
      await runtimeCredentialOverrides.applyTo((provider, apiKey) => (
        services.modelRuntime.setRuntimeApiKey(provider, apiKey)
      ));
      return services;
    }).catch((error: unknown) => {
      unsubscribe?.();
      unsubscribe = undefined;
      servicesLoad = undefined;
      throw error;
    });
    return servicesLoad;
  };

  return {
    async list() {
      const services = await load();
      return projectRuntimeProviders(services.modelRuntime);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await servicesLoad?.catch(() => undefined);
      unsubscribe?.();
      unsubscribe = undefined;
      if (ownsRuntimeCredentialOverrides) await runtimeCredentialOverrides.clear();
    }
  };
}

function disposedError(): RuntimeError {
  return new RuntimeError("RUNTIME_NOT_READY", "The Workspace Provider catalog has been disposed.");
}
