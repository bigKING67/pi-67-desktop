import {
  hasPi67SharedExperienceReadContract,
  networkReadTarget
} from "./tool-input-contracts.js";

export function classifyPi67ContextToolIntent(
  toolName: string,
  input: Record<string, unknown>,
  sourceLabel: string
) {
  if (hasPi67SharedExperienceReadContract(toolName, input)) {
    return {
      toolName,
      category: "network-read" as const,
      target: networkReadTarget(input, toolName),
      targetKind: "tool" as const,
      sourceLabel
    };
  }
  return {
    toolName,
    category: "unverified-tool" as const,
    target: toolName,
    targetKind: "tool" as const,
    sourceLabel,
    nonApprovableReason: "企业 Experience Tool 参数不符合 Desktop 的只读合同；请修正 query、limit 或 id 后重试。"
  };
}
