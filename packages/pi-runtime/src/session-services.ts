import {
  createAgentSessionServices,
  type AgentSessionServices,
  type ModelRuntime,
  type SettingsManager
} from "@earendil-works/pi-coding-agent";
import { restoreRuntimeApiKeys } from "./model-control.js";
import type { RuntimeCredentialOverrideStore } from "./runtime-credential-overrides.js";
import {
  createDesktopSafetyExtension,
  type DesktopApprovalRequester,
  type SafetyPolicyState
} from "./safety-extension.js";

interface DesktopSessionServicesOptions {
  cwd: string;
  agentDir: string;
  runtimeApiKeys?: ReadonlyMap<string, string>;
  runtimeCredentialOverrides?: RuntimeCredentialOverrideStore;
  settingsManager?: SettingsManager;
  modelRuntime?: ModelRuntime;
  getSafety: () => SafetyPolicyState;
  requestApproval: DesktopApprovalRequester;
}

export async function createDesktopSessionServices(
  options: DesktopSessionServicesOptions
): Promise<AgentSessionServices> {
  const services = await createAgentSessionServices({
    cwd: options.cwd,
    agentDir: options.agentDir,
    ...(options.settingsManager === undefined ? {} : { settingsManager: options.settingsManager }),
    ...(options.modelRuntime === undefined ? {} : { modelRuntime: options.modelRuntime }),
    resourceLoaderOptions: {
      extensionFactories: [createDesktopSafetyExtension(options.getSafety, options.requestApproval)]
    },
    resourceLoaderReloadOptions: {
      resolveProjectTrust: async () => options.getSafety().trust === "trusted"
    }
  });
  if (options.runtimeCredentialOverrides) {
    await options.runtimeCredentialOverrides.applyTo((provider, apiKey) => (
      services.modelRuntime.setRuntimeApiKey(provider, apiKey, { allowNetwork: false })
    ));
  } else {
    await restoreRuntimeApiKeys(services, options.runtimeApiKeys ?? new Map());
  }
  return services;
}
