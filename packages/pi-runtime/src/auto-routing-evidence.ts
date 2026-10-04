import type { AutoRoutingPart } from "@pi67/domain";

export const AUTO_ROUTING_ENTRY = "pi67.auto-routing.v1";
export interface AutoRoutingEvidence extends Omit<AutoRoutingPart, "type"> {
  version: 1;
  createdAt: number;
}

export function parseAutoRoutingEvidence(value: unknown): AutoRoutingEvidence | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Partial<AutoRoutingEvidence>;
  if (data.version !== 1 || !Number.isSafeInteger(data.createdAt) || data.createdAt! < 0
    || !["selected", "failed"].includes(data.status ?? "")
    || !["standard", "complex", "image-capability", "judge-failed", "invalid-decision", "cancelled", "timed-out"].includes(data.reason ?? "")
    || !isSelection(data.judge) || typeof data.inputTruncated !== "boolean"
    || (data.status === "selected" && !isSelection(data.selected))
    || (data.selected !== undefined && !isSelection(data.selected))
    || [data.totalTokens, data.totalCost].some((number) => number !== undefined && (!Number.isFinite(number) || number < 0))) return undefined;
  return { version: 1, createdAt: data.createdAt!, status: data.status!, reason: data.reason!, judge: data.judge,
    inputTruncated: data.inputTruncated,
    ...(data.selected ? { selected: data.selected } : {}),
    ...(data.totalTokens === undefined ? {} : { totalTokens: data.totalTokens }),
    ...(data.totalCost === undefined ? {} : { totalCost: data.totalCost }) };
}

function isSelection(value: unknown): value is { provider: string; model: string } {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return [item.provider, item.model].every((text) => typeof text === "string" && text.length > 0 && text.length <= 512);
}
