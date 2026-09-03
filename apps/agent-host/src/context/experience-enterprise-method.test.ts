import { describe, expect, it } from "vitest";
import { validateEnterpriseExperienceMethod } from "./experience-enterprise-method.js";

describe("validateEnterpriseExperienceMethod", () => {
  it("preserves the structured reviewed method for the enterprise Gateway", () => {
    expect(validateEnterpriseExperienceMethod(method())).toEqual(method());
  });

  it("rejects fields that exceed the enterprise Gateway method limits", () => {
    expect(() => validateEnterpriseExperienceMethod({
      ...method(),
      validationGates: ["x".repeat(501)]
    })).toThrow("validation gate");
    expect(() => validateEnterpriseExperienceMethod({
      ...method(),
      rollback: "x".repeat(2_001)
    })).toThrow("rollback");
  });
});

function method() {
  return {
    preconditions: ["The Host epoch changed"],
    steps: ["Cancel stale operations", "Restore the active Session"],
    tools: ["packaged smoke"],
    validationGates: ["No stale Projection remains"],
    completionCriteria: ["The active Session resumes"],
    failureModes: ["An old approval remains visible"],
    rollback: "Restore the prior Host build."
  };
}
