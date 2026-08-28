export const GROLAND_CLAUDE_MODEL_IDS = [
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-sonnet-5"
] as const;

export const GROLAND_GPT_MODEL_IDS = ["gpt-5.4", "gpt-5.5"] as const;

export type GrolandNativeSearchApi = "anthropic-messages" | "openai-responses";

const DEEPSEEK_PROVIDER_ID = "deepseek";
const DEEPSEEK_API_HOSTNAME = "api.deepseek.com";

const GROLAND_CLAUDE_MODEL_ID_SET = new Set<string>(GROLAND_CLAUDE_MODEL_IDS);
const GROLAND_GPT_MODEL_ID_SET = new Set<string>(GROLAND_GPT_MODEL_IDS);

export function grolandNativeSearchApi(
  modelId: string,
  api: string
): GrolandNativeSearchApi | undefined {
  if (api === "anthropic-messages" && GROLAND_CLAUDE_MODEL_ID_SET.has(modelId)) {
    return api;
  }
  if (api === "openai-responses" && GROLAND_GPT_MODEL_ID_SET.has(modelId)) {
    return api;
  }
  return undefined;
}

export function deepSeekNativeSearchEndpoint(
  providerId: string,
  baseUrl: string | undefined
): string | undefined {
  if (providerId.trim().toLocaleLowerCase() !== DEEPSEEK_PROVIDER_ID || !baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/u, "");
    if (
      url.protocol !== "https:"
      || url.hostname.toLocaleLowerCase() !== DEEPSEEK_API_HOSTNAME
      || Boolean(url.username || url.password)
      || Boolean(url.port && url.port !== "443")
      || !["", "/v1", "/responses", "/v1/responses"].includes(path)
    ) return undefined;
    url.port = "";
    url.pathname = "/responses";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}
