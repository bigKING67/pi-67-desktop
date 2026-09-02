import {
  createAgentSessionServices,
  SettingsManager,
  type AgentSessionServices,
  type ModelRuntime
} from "@earendil-works/pi-coding-agent";
import {
  createDesktopPackageSettingsView,
  managedDesktopExtensionPaths
} from "./desktop-package-toolchain.js";
import { inspectDesktopMemoryOwners } from "./desktop-memory-owner-preflight.js";
import { recordDesktopMemoryOwnerLoadReceipt } from "./desktop-memory-owner-load-receipt.js";
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
import {
  bindConfiguredCapabilityCatalog,
  ConfiguredCapabilityCatalog
} from "./configured-capability-catalog.js";
import { createDesktopEnvironmentExtension } from "./desktop-environment-extension.js";
import type { PackageTrustRegistry } from "./package-trust-registry.js";
import { installFirstPartyModelProviders } from "./first-party-model-providers.js";
import { createDesktopPlanModeExtension } from "./plan-mode-controller.js";
import type { SessionInteractionMode } from "@pi67/domain";

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
  packageTrustRegistry?: Pick<PackageTrustRegistry, "refresh" | "runtimePackageAllowed">;
  packageTrustRefresh?: Promise<void>;
  getInteractionMode?: () => SessionInteractionMode;
  noThirdPartyExtensions?: boolean;
}

export async function createDesktopSessionServices(
  options: DesktopSessionServicesOptions
): Promise<AgentSessionServices> {
  const getInteractionMode = options.getInteractionMode ?? (() => "execute" as const);
  await (options.packageTrustRefresh ?? options.packageTrustRegistry?.refresh());
  const loadedResourceReadAccess = createLoadedResourceReadAccess();
  const projectTrusted = options.getSafety().trust === "trusted";
  const baseSettingsManager = options.settingsManager ?? SettingsManager.create(
    options.cwd,
    options.agentDir,
    { projectTrusted }
  );
  baseSettingsManager.setProjectTrusted(projectTrusted);
  const admittedSettingsManager = createDesktopPackageSettingsView(
    baseSettingsManager,
    process.env,
    options.packageTrustRegistry
  );
  const configuredManagedExtensions = options.noThirdPartyExtensions
    ? managedDesktopExtensionPaths()
    : [];
  const memoryOwnerPreflight = inspectDesktopMemoryOwners({
    cwd: options.cwd,
    agentDir: options.agentDir,
    reservedOwner: "pi67-openviking",
    ...(options.noThirdPartyExtensions
      ? { managedExtensionPaths: configuredManagedExtensions }
      : { settingsManager: admittedSettingsManager })
  });
  const settingsManager = memoryOwnerPreflight.blockedOwners.length > 0
    ? createDesktopPackageSettingsView(
        baseSettingsManager,
        process.env,
        options.packageTrustRegistry,
        memoryOwnerPreflight
      )
    : admittedSettingsManager;
  const configuredCapabilities = new ConfiguredCapabilityCatalog({
    agentDir: options.agentDir,
    settingsManager
  });
  const services = await createAgentSessionServices({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    ...(options.modelRuntime === undefined ? {} : { modelRuntime: options.modelRuntime }),
    resourceLoaderOptions: {
      ...(options.noThirdPartyExtensions
        ? {
            noExtensions: true,
            additionalExtensionPaths: managedDesktopExtensionPaths(
              process.env,
              memoryOwnerPreflight
            )
          }
        : {}),
      extensionFactories: [
        createDesktopToolRoutingExtension(),
        ...(options.promptAttachmentAccess === undefined
          ? []
          : [createDesktopPromptAttachmentExtension(options.promptAttachmentAccess)]),
        createDesktopSafetyExtension(
          options.getSafety,
          options.requestApproval,
          loadedResourceReadAccess,
          configuredCapabilities,
          options.recordToolAuthorization,
          getInteractionMode
        ),
        createDesktopPlanModeExtension(getInteractionMode),
        createDesktopEnvironmentExtension()
      ]
    }
  });
  recordDesktopMemoryOwnerLoadReceipt(
    options.agentDir,
    memoryOwnerPreflight,
    services.resourceLoader.getExtensions().extensions
      .map((extension) => extension.resolvedPath)
      .filter((path): path is string => typeof path === "string")
  );
  await installFirstPartyModelProviders(services.modelRuntime);
  configuredCapabilities.useSettingsManager(services.settingsManager);
  await Promise.all([
    loadedResourceReadAccess.refresh(services.resourceLoader),
    configuredCapabilities.refresh()
  ]);
  bindLoadedResourceReadAccess(services.resourceLoader, loadedResourceReadAccess);
  bindConfiguredCapabilityCatalog(services.resourceLoader, configuredCapabilities);
  if (options.runtimeCredentialOverrides) {
    await options.runtimeCredentialOverrides.applyTo((provider, apiKey) => (
      services.modelRuntime.setRuntimeApiKey(provider, apiKey)
    ));
  } else {
    await restoreRuntimeApiKeys(services, options.runtimeApiKeys ?? new Map());
  }
  return services;
}
