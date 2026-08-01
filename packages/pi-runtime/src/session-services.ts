import {
  createAgentSessionServices,
  type AgentSessionServices,
  type ModelRuntime,
  type SettingsManager
} from "@earendil-works/pi-coding-agent";
import { createDesktopPackageSettingsView } from "./desktop-package-toolchain.js";
import { restoreRuntimeApiKeys } from "./model-control.js";
import type { RuntimeCredentialOverrideStore } from "./runtime-credential-overrides.js";
import {
  createDesktopSafetyExtension,
  type DesktopApprovalRequester,
  type DesktopToolAuthorizationRecorder,
  type SafetyPolicyState
} from "./safety-extension.js";
import { createDesktopToolRoutingExtension } from "./tool-routing-extension.js";
import { createDesktopPromptAttachmentExtension } from "./prompt-attachment-extension.js";
import type { PromptAttachmentAccess } from "./prompt-attachment.js";
import {
  bindLoadedResourceReadAccess,
  createLoadedResourceReadAccess
} from "./loaded-resource-read-access.js";
import { createDesktopPiWebAccessResultExtension } from "./pi-web-access-result-extension.js";
import {
  bindConfiguredCapabilityCatalog,
  ConfiguredCapabilityCatalog
} from "./configured-capability-catalog.js";

interface DesktopSessionServicesOptions {
  cwd: string;
  agentDir: string;
  runtimeApiKeys?: ReadonlyMap<string, string>;
  runtimeCredentialOverrides?: RuntimeCredentialOverrideStore;
  settingsManager?: SettingsManager;
  modelRuntime?: ModelRuntime;
  getSafety: () => SafetyPolicyState;
  requestApproval: DesktopApprovalRequester;
  recordToolAuthorization?: DesktopToolAuthorizationRecorder;
  promptAttachmentAccess?: PromptAttachmentAccess;
}

export async function createDesktopSessionServices(
  options: DesktopSessionServicesOptions
): Promise<AgentSessionServices> {
  const loadedResourceReadAccess = createLoadedResourceReadAccess();
  const settingsManager = options.settingsManager === undefined
    ? undefined
    : createDesktopPackageSettingsView(options.settingsManager);
  const configuredCapabilities = new ConfiguredCapabilityCatalog({
    agentDir: options.agentDir,
    settingsManager: settingsManager ?? { getPackages: () => [] }
  });
  const services = await createAgentSessionServices({
    cwd: options.cwd,
    agentDir: options.agentDir,
    ...(settingsManager === undefined ? {} : { settingsManager }),
    ...(options.modelRuntime === undefined ? {} : { modelRuntime: options.modelRuntime }),
    resourceLoaderOptions: {
      extensionFactories: [
        createDesktopToolRoutingExtension(),
        createDesktopPiWebAccessResultExtension(),
        ...(options.promptAttachmentAccess === undefined
          ? []
          : [createDesktopPromptAttachmentExtension(options.promptAttachmentAccess)]),
        createDesktopSafetyExtension(
          options.getSafety,
          options.requestApproval,
          loadedResourceReadAccess,
          configuredCapabilities,
          options.recordToolAuthorization
        )
      ]
    },
    resourceLoaderReloadOptions: {
      resolveProjectTrust: async () => options.getSafety().trust === "trusted"
    }
  });
  configuredCapabilities.useSettingsManager(services.settingsManager);
  await Promise.all([
    loadedResourceReadAccess.refresh(services.resourceLoader),
    configuredCapabilities.refresh()
  ]);
  bindLoadedResourceReadAccess(services.resourceLoader, loadedResourceReadAccess);
  bindConfiguredCapabilityCatalog(services.resourceLoader, configuredCapabilities);
  if (options.runtimeCredentialOverrides) {
    await options.runtimeCredentialOverrides.applyTo((provider, apiKey) => (
      services.modelRuntime.setRuntimeApiKey(provider, apiKey, { allowNetwork: false })
    ));
  } else {
    await restoreRuntimeApiKeys(services, options.runtimeApiKeys ?? new Map());
  }
  return services;
}
