import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { GROLAND_CLAUDE_MODEL_IDS, GROLAND_GPT_MODEL_IDS, IMAGE_PROVIDER_ID } from "@pi67/domain";
import { imageProviderBaseUrl, imageProviderRegistration } from "./image-workbench-provider.js";

export const GROLAND_PROVIDER_ID = "groland";
export const GROLAND_ANTHROPIC_BASE_URL = "https://api.sciencetoken.ai/proxy/anthropic";
export const GROLAND_OPENAI_BASE_URL = "https://api.sciencetoken.ai/proxy/openai/v1";

type ProviderRegistration = Parameters<ModelRuntime["registerProvider"]>[1];
type ModelRuntimeRefresh = ModelRuntime["refresh"];

const PROVIDER_INSTALLATIONS = new WeakMap<ModelRuntime, Promise<void>>();

export const GROLAND_PROVIDER_REGISTRATION: ProviderRegistration = Object.freeze({
  name: "Groland",
  authHeader: false,
  models: [
    ...GROLAND_CLAUDE_MODEL_IDS.map((id) => ({
      id,
      name: id,
      api: "anthropic-messages" as const,
      baseUrl: GROLAND_ANTHROPIC_BASE_URL,
      input: ["text", "image"] as Array<"text" | "image">,
      reasoning: true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 64_000
    })),
    ...GROLAND_GPT_MODEL_IDS.map((id) => ({
      id,
      name: id,
      api: "openai-responses" as const,
      baseUrl: GROLAND_OPENAI_BASE_URL,
      input: ["text", "image"] as Array<"text" | "image">,
      reasoning: true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 400_000,
      maxTokens: 128_000
    }))
  ]
});

/**
 * Registers Groland and, when the user's `models.json` in `agentDirectory`
 * configures `newmoney-images`, the image workbench Provider (ADR 0010
 * decision 13). Credentials stay in Pi's configuration.
 */
export function installFirstPartyModelProviders(runtime: ModelRuntime, agentDirectory?: string): Promise<void> {
  const existing = PROVIDER_INSTALLATIONS.get(runtime);
  if (existing) return existing;

  const imageBaseUrl = agentDirectory === undefined ? undefined : imageProviderBaseUrl(agentDirectory);
  const registrations: [string, ProviderRegistration][] = [[GROLAND_PROVIDER_ID, GROLAND_PROVIDER_REGISTRATION]];
  if (imageBaseUrl) registrations.push([IMAGE_PROVIDER_ID, imageProviderRegistration(imageBaseUrl) as ProviderRegistration]);
  const installation = registerProvidersAndAwaitRefresh(runtime, registrations).catch((error: unknown) => {
    if (PROVIDER_INSTALLATIONS.get(runtime) === installation) {
      PROVIDER_INSTALLATIONS.delete(runtime);
    }
    throw error;
  });
  PROVIDER_INSTALLATIONS.set(runtime, installation);
  return installation;
}

async function registerProvidersAndAwaitRefresh(
  runtime: ModelRuntime,
  registrations: readonly [string, ProviderRegistration][]
): Promise<void> {
  const ownRefresh = Object.getOwnPropertyDescriptor(runtime, "refresh");
  const originalRefresh = runtime.refresh.bind(runtime);
  const registrationRefreshes: ReturnType<ModelRuntimeRefresh>[] = [];
  const captureRefresh: ModelRuntimeRefresh = function captureRefresh(options) {
    const pending = originalRefresh(options);
    registrationRefreshes.push(pending);
    return pending;
  };

  // Pi 0.83 starts an unreturned refresh from registerProvider; capture it so
  // the caller's runtime-creation budget owns provider installation as well.
  Object.defineProperty(runtime, "refresh", {
    configurable: true,
    writable: true,
    value: captureRefresh
  });
  try {
    for (const [id, registration] of registrations) runtime.registerProvider(id, registration);
  } finally {
    if (ownRefresh) Object.defineProperty(runtime, "refresh", ownRefresh);
    else Reflect.deleteProperty(runtime, "refresh");
  }

  if (registrationRefreshes.length < registrations.length) {
    throw new Error("First-party Provider registration did not start the required offline refresh.");
  }
  await Promise.all(registrationRefreshes);
}
