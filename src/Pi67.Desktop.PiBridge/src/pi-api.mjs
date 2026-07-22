import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bridgeError } from "./protocol.mjs";

export async function loadInstalledPi(packageRoot) {
  if (typeof packageRoot !== "string" || packageRoot.trim() === "") {
    throw bridgeError("bridge.pi_package_missing", "PI67_DESKTOP_PI_PACKAGE_ROOT is not configured");
  }

  const root = resolve(packageRoot);
  const entry = join(root, "dist", "index.js");
  try {
    await access(entry, constants.R_OK);
  } catch {
    throw bridgeError("bridge.pi_package_invalid", "The installed Pi package does not expose dist/index.js");
  }

  const api = await import(pathToFileURL(entry).href);
  for (const name of ["AuthStorage", "ModelRegistry", "SettingsManager", "ProjectTrustStore", "hasTrustRequiringProjectResources"]) {
    if (!(name in api)) {
      throw bridgeError("bridge.pi_capability_missing", `Installed Pi does not export ${name}`);
    }
  }
  return api;
}

export function createPiServices(api, { agentDirectory, workspace }) {
  const authStorage = api.AuthStorage.create();
  const modelRegistry = api.ModelRegistry.create(authStorage);
  const settingsManager = api.SettingsManager.create(workspace, agentDirectory, { projectTrusted: false });
  const trustStore = new api.ProjectTrustStore(agentDirectory);
  return { api, authStorage, modelRegistry, settingsManager, trustStore, agentDirectory, workspace };
}

export function summarizeModels(services) {
  const defaults = services.settingsManager.getGlobalSettings();
  return services.modelRegistry.getAll().map((model) => ({
    provider: model.provider,
    id: model.id,
    displayName: model.name ?? model.id,
    thinkingLevels: Object.keys(model.thinkingLevelMap ?? {}),
    supportsImages: Array.isArray(model.input) && model.input.includes("image"),
    isDefault: defaults.defaultProvider === model.provider && defaults.defaultModel === model.id,
  }));
}

export function summarizeAuth(services) {
  const providers = new Set(services.modelRegistry.getAll().map((model) => model.provider));
  const oauthProviders = new Map(services.authStorage.getOAuthProviders().map((provider) => [provider.id, provider]));
  for (const provider of oauthProviders.keys()) providers.add(provider);

  return [...providers].sort().map((providerId) => {
    const status = services.modelRegistry.getProviderAuthStatus(providerId);
    return {
      providerId,
      configured: status.configured === true,
      source: status.source ?? "none",
      accountLabel: status.label ?? null,
      supportsApiKey: true,
      supportsOAuth: oauthProviders.has(providerId),
    };
  });
}

export function inspectSettings(services) {
  const settings = services.settingsManager.getGlobalSettings();
  return {
    defaultProvider: settings.defaultProvider ?? null,
    defaultModel: settings.defaultModel ?? null,
    defaultThinkingLevel: settings.defaultThinkingLevel ?? null,
    steeringMode: settings.steeringMode ?? "one-at-a-time",
    followUpMode: settings.followUpMode ?? "one-at-a-time",
    defaultProjectTrust: settings.defaultProjectTrust ?? "ask",
    offline: process.env.PI_OFFLINE === "1",
  };
}

export function inspectTrust(services, workspace) {
  const canonicalWorkspace = resolve(workspace);
  const entry = services.trustStore.getEntry(canonicalWorkspace);
  const requiresTrust = services.api.hasTrustRequiringProjectResources(canonicalWorkspace);
  return {
    workspacePath: canonicalWorkspace,
    state: entry === null ? "unknown" : entry.decision ? "trustedPersistently" : "denied",
    persisted: entry !== null,
    trustRequiringResources: requiresTrust ? ["project-local Pi resources"] : [],
    reason: requiresTrust ? "Project-local Pi resources require an explicit trust decision." : "No trust-requiring project resources were found.",
  };
}
