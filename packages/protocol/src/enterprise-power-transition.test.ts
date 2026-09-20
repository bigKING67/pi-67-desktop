import { expect, it } from "vitest";
import { isEnterprisePowerTransitionMessage } from "./enterprise-power-transition.js";

it("accepts only exact Main power transitions without credentials or extra fields", () => {
  for (const state of ["suspend", "resume"]) expect(isEnterprisePowerTransitionMessage({ type: "enterprise-power-transition", state })).toBe(true);
  for (const value of [null, {}, { type: "enterprise-power-transition", state: "running" },
    { type: "enterprise-power-transition", state: "resume", userId: "other" }]) expect(isEnterprisePowerTransitionMessage(value)).toBe(false);
});
