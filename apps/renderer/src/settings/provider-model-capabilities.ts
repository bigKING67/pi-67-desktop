import { grolandNativeSearchApi } from "@pi67/domain";
import type { PiModelConfigurationInput, PiModelConfigurationView } from "@pi67/protocol";

export interface ModelCapabilityView {
  protocol: string;
  image: boolean;
  reasoning: boolean;
  search: "native-declared" | "unavailable";
}

export function modelCapabilityView(
  providerId: string,
  model: PiModelConfigurationInput,
  existingView?: PiModelConfigurationView,
  providerApi?: string
): ModelCapabilityView {
  const protocol = model.api ?? existingView?.api ?? providerApi ?? "Pi 内置";
  const normalizedProvider = normalizeCapabilityId(providerId);
  const normalizedProtocol = normalizeCapabilityId(protocol);
  const nativeSearch = (
    normalizedProvider === "groland"
    && grolandNativeSearchApi(model.id, normalizedProtocol) !== undefined
  )
    || (normalizedProvider === "anthropic" && normalizedProtocol === "anthropic-messages")
    || (normalizedProvider === "openai" && normalizedProtocol === "openai-responses")
    || (normalizedProvider === "deepseek" && model.id === "deepseek-v4-flash");
  return {
    protocol,
    image: model.input?.includes("image") ?? existingView?.input.includes("image") ?? false,
    reasoning: model.reasoning ?? existingView?.reasoning ?? false,
    search: nativeSearch ? "native-declared" : "unavailable"
  };
}

function normalizeCapabilityId(value: string): string {
  return value.trim().toLocaleLowerCase();
}
