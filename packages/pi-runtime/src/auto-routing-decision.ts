import type { Api, SimpleStreamOptions } from "@earendil-works/pi-ai";

export type AutoRoutingDecision = "standard" | "complex";

/** Pi owns transport. These native sampling options only constrain judge output. */
export function autoRoutingDecisionOptions(api: Api): Pick<SimpleStreamOptions, "samplingParams"> {
  const format = {
    name: "pi67_task_complexity",
    strict: true,
    schema: {
      type: "object",
      properties: { complexity: { type: "string", enum: ["standard", "complex"] } },
      required: ["complexity"],
      additionalProperties: false
    }
  };
  if (api === "openai-completions") {
    return { samplingParams: { response_format: { type: "json_schema", json_schema: format } } };
  }
  if (api === "openai-responses" || api === "azure-openai-responses") {
    return { samplingParams: { text: { format: { type: "json_schema", ...format } } } };
  }
  // Other Pi APIs retain prompt-directed JSON and the same strict local parser.
  // Do not send foreign protocol fields or claim provider-side enforcement.
  return {};
}

/** Never extract a label from prose, repair JSON, or accept extra decision fields. */
export function parseAutoRoutingDecision(text: string): AutoRoutingDecision | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "complexity") return undefined;
  return record.complexity === "standard" || record.complexity === "complex" ? record.complexity : undefined;
}
