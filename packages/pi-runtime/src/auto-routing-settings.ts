import type { PiAutoRoutingSelection, PiDefaultModelSelection } from "@pi67/protocol";

export function parseAutoRoutingSelection(value: unknown): PiAutoRoutingSelection | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error("settings.json pi67Desktop.autoRouting must contain judge, standard, and complex model selections.");
  }
  return {
    judge: parseAutoRoutingModel(value.judge, "judge"),
    standard: parseAutoRoutingModel(value.standard, "standard"),
    complex: parseAutoRoutingModel(value.complex, "complex")
  };
}

function parseAutoRoutingModel(value: unknown, role: "judge" | "standard" | "complex"): PiDefaultModelSelection {
  if (!isRecord(value)) {
    throw new Error(`settings.json pi67Desktop.autoRouting.${role} must select a Provider/model.`);
  }
  const provider = identifier(value.provider);
  const model = identifier(value.model);
  if (!provider || !model) {
    throw new Error(`settings.json pi67Desktop.autoRouting.${role} must select a Provider/model.`);
  }
  return { provider, model };
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function identifier(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512 ? value.trim() : undefined;
}
