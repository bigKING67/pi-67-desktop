import type { ExperienceMethodSummary } from "@pi67/domain";
import { HostCommandError } from "../protocol-error.js";

const ENTERPRISE_METHOD_LIMITS = {
  preconditions: { items: 40, characters: 500, label: "precondition" },
  steps: { items: 80, characters: 1_000, label: "step" },
  tools: { items: 40, characters: 300, label: "tool" },
  validationGates: { items: 40, characters: 500, label: "validation gate" },
  completionCriteria: { items: 40, characters: 500, label: "completion criterion" },
  failureModes: { items: 40, characters: 500, label: "failure mode" }
} as const;

export function validateEnterpriseExperienceMethod(
  method: ExperienceMethodSummary
): ExperienceMethodSummary {
  for (const [field, limits] of Object.entries(ENTERPRISE_METHOD_LIMITS)) {
    const values = method[field as keyof typeof ENTERPRISE_METHOD_LIMITS];
    if (values.length > limits.items || values.some((value) => value.length > limits.characters)) {
      throw methodLimitError(limits.label);
    }
  }
  if (method.rollback.length > 2_000) throw methodLimitError("rollback");
  return {
    preconditions: [...method.preconditions],
    steps: [...method.steps],
    tools: [...method.tools],
    validationGates: [...method.validationGates],
    completionCriteria: [...method.completionCriteria],
    failureModes: [...method.failureModes],
    rollback: method.rollback
  };
}

function methodLimitError(field: string): HostCommandError {
  return new HostCommandError(
    "RESOURCE_LIMIT_EXCEEDED",
    `The reviewed Experience ${field} exceeds the enterprise Gateway contract.`,
    true
  );
}
