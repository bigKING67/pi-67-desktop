import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { GROLAND_CLAUDE_MODEL_IDS, GROLAND_GPT_MODEL_IDS } from "@pi67/domain";

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

export function installFirstPartyModelProviders(runtime: ModelRuntime): Promise<void> {
  const existing = PROVIDER_INSTALLATIONS.get(runtime);
  if (existing) return existing;

  const installation = registerProviderAndAwaitRefresh(runtime).catch((error: unknown) => {
    if (PROVIDER_INSTALLATIONS.get(runtime) === installation) {
      PROVIDER_INSTALLATIONS.delete(runtime);
    }
    throw error;
  });
  PROVIDER_INSTALLATIONS.set(runtime, installation);
  return installation;
}

async function registerProviderAndAwaitRefresh(runtime: ModelRuntime): Promise<void> {
  const ownRefresh = Object.getOwnPropertyDescriptor(runtime, "refresh");
  const originalRefresh = runtime.refresh.bind(runtime);
  let registrationRefresh: ReturnType<ModelRuntimeRefresh> | undefined;
  const captureRefresh: ModelRuntimeRefresh = function captureRefresh(options) {
    const pending = originalRefresh(options);
    registrationRefresh ??= pending;
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
    runtime.registerProvider(GROLAND_PROVIDER_ID, GROLAND_PROVIDER_REGISTRATION);
  } finally {
    if (ownRefresh) Object.defineProperty(runtime, "refresh", ownRefresh);
    else Reflect.deleteProperty(runtime, "refresh");
  }

  if (!registrationRefresh) {
    throw new Error("Groland Provider registration did not start the required offline refresh.");
  }
  await registrationRefresh;
}
