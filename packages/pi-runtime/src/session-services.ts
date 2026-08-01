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
  type SafetyPolicyState
} from "./safety-extension.js";
import { createDesktopToolRoutingExtension } from "./tool-routing-extension.js";
import { createDesktopPromptAttachmentExtension } from "./prompt-attachment-extension.js";
import type { PromptAttachmentAccess } from "./prompt-attachment.js";

interface DesktopSessionServicesOptions {
  cwd: string;
  agentDir: string;
  runtimeApiKeys?: ReadonlyMap<string, string>;
  runtimeCredentialOverrides?: RuntimeCredentialOverrideStore;
  settingsManager?: SettingsManager;
  modelRuntime?: ModelRuntime;
  getSafety: () => SafetyPolicyState;
  requestApproval: DesktopApprovalRequester;
  promptAttachmentAccess?: PromptAttachmentAccess;
}

export async function createDesktopSessionServices(
  options: DesktopSessionServicesOptions
): Promise<AgentSessionServices> {
  const settingsManager = options.settingsManager === undefined
    ? undefined
    : createDesktopPackageSettingsView(options.settingsManager);
  const services = await createAgentSessionServices({
    cwd: options.cwd,
    agentDir: options.agentDir,
    ...(settingsManager === undefined ? {} : { settingsManager }),
    ...(options.modelRuntime === undefined ? {} : { modelRuntime: options.modelRuntime }),
    resourceLoaderOptions: {
      extensionFactories: [
        createDesktopToolRoutingExtension(),
        ...(options.promptAttachmentAccess === undefined
          ? []
          : [createDesktopPromptAttachmentExtension(options.promptAttachmentAccess)]),
        createDesktopSafetyExtension(options.getSafety, options.requestApproval)
      ]
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
