import { expect, it } from "vitest";
import { EnterprisePowerEpoch } from "./enterprise-power-epoch.js";

it("rejects new grants while suspended and never revives earlier grants on resume", () => {
  const power = new EnterprisePowerEpoch();
  const initial = power.capture(); initial();
  power.transition("suspend");
  expect(initial).toThrow("power transition");
  expect(() => power.capture()).toThrow("power transition");
  power.transition("resume");
  expect(initial).toThrow("power transition");
  const resumed = power.capture(); resumed();
  power.transition("resume");
  expect(resumed).toThrow("power transition");
  expect(() => power.capture()()).not.toThrow();
});

it("actively aborts old work on every transition without reviving an old signal", () => {
  const power = new EnterprisePowerEpoch();
  const initial = power.signal;
  expect(initial.aborted).toBe(false);
  power.transition("suspend");
  expect(initial.aborted).toBe(true);
  expect(power.signal.aborted).toBe(true);
  power.transition("resume");
  const resumed = power.signal;
  expect(resumed.aborted).toBe(false);
  expect(initial.aborted).toBe(true);
  power.transition("resume");
  expect(resumed.aborted).toBe(true);
  expect(power.signal.aborted).toBe(false);
});
