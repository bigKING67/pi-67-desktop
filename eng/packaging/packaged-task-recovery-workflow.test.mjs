import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { RECOVERY_SCENARIOS, selectRecoveryScenario } from "./packaged-task-recovery-fixture.mjs";

it.each([
  ["ci.yml", "native-windows"], ["ci.yml", "native-macos"], ["windows-candidate.yml", "build-windows"]
])("requires each isolated scenario and always retains receipts: %s %s", async (name, job) => {
  const text = await readFile(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8");
  const body = text.split(`\n  ${job}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/u)[0];
  expect(body).toBeDefined();
  const smokeIndex = body.indexOf("run package:smoke\n");
  expect(smokeIndex).toBeGreaterThan(0);
  for (const scenario of RECOVERY_SCENARIOS) {
    const command = name === "ci.yml" ? "pnpm" : "corepack pnpm";
    const step = `run: ${command} run package:smoke:task-recovery -- ${scenario}`;
    expect(body.split(step)).toHaveLength(2);
    expect(body.indexOf(step)).toBeGreaterThan(smokeIndex);
  }
  expect(body).toMatch(/name: Upload packaged task recovery evidence\n\s+if: always\(\)/u);
  expect(body).toContain("path: artifacts/validation/pi-durable-compat/packaged/");
  expect(body).not.toContain("continue-on-error: true");
});

it.each(RECOVERY_SCENARIOS)("accepts direct and pnpm-separated scenario %s", scenario => {
  expect(selectRecoveryScenario([scenario])).toBe(scenario);
  expect(selectRecoveryScenario(["--", scenario])).toBe(scenario);
});

it.each([[], ["--"], ["all"], ["agent-before-response", "app-after-tool"], ["--", "--", "agent-before-response"]].map(args => ({ args })))(
  "rejects ambiguous or unbounded scenario arguments $args", ({ args }) => {
    expect(() => selectRecoveryScenario(args)).toThrow("Select exactly one bounded scenario");
  }
);
