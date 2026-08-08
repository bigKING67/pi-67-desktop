export const GROLAND_CLAUDE_MODEL_IDS = [
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-sonnet-5"
] as const;

export const GROLAND_GPT_MODEL_IDS = ["gpt-5.4", "gpt-5.5"] as const;

export type GrolandNativeSearchApi = "anthropic-messages" | "openai-responses";

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
