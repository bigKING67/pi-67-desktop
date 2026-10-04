import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { clickRecoveryAction, RECOVERY_SCENARIOS, selectRecoveryScenario } from "./packaged-task-recovery-fixture.mjs";

it("does not click a recovery action after automatic reopen already finished", async () => {
  const action = { click: vi.fn() };
  await clickRecoveryAction(action, async () => true);
  expect(action.click).not.toHaveBeenCalled();
});

it("accepts a detached recovery action only when the Session actually became ready", async () => {
  const error = Object.assign(new Error("action detached"), { name: "TimeoutError" });
  const action = { click: vi.fn().mockRejectedValue(error) };
  const isReady = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  await clickRecoveryAction(action, isReady);
  expect(action.click).toHaveBeenCalledExactlyOnceWith({ timeout: 2_000 });
  await expect(clickRecoveryAction(action, async () => false, async () => false)).rejects.toBe(error);
});

it("defers a click timeout during observed bootstrap to the caller's readiness deadline", async () => {
  const error = Object.assign(new Error("action detached during bootstrap"), { name: "TimeoutError" });
  const action = { click: vi.fn().mockRejectedValue(error) };
  const isReady = vi.fn().mockResolvedValue(false);
  const isOpening = vi.fn().mockResolvedValue(true);
  await clickRecoveryAction(action, isReady, isOpening);
  expect(action.click).toHaveBeenCalledExactlyOnceWith({ timeout: 2_000 });
  expect(isOpening).toHaveBeenCalledOnce();
  expect(await isReady()).toBe(false); // Action completion does not certify readiness.
  isOpening.mockResolvedValue(false);
  await expect(clickRecoveryAction(action, isReady, isOpening)).rejects.toBe(error);
});

it("performs manual recovery and preserves non-timeout driver failures", async () => {
  const error = new Error("driver disconnected");
  const action = { click: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(error) };
  await clickRecoveryAction(action, async () => false);
  await expect(clickRecoveryAction(action, async () => true)).resolves.toBeUndefined();
  await expect(clickRecoveryAction(action, async () => false, async () => true)).rejects.toBe(error);
  expect(action.click).toHaveBeenCalledTimes(2);
});

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

it.each(["native-windows", "native-macos"])("keeps independent packaged evidence after a failure without bypassing the gate: %s", async job => {
  const text = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const body = text.split(`\n  ${job}:\n`)[1].split(/\n  [a-z][a-z-]+:\n/u)[0];
  const steps = body.split("      - name: ");
  const packageStep = steps.find(step => step.startsWith("Build fast unsigned "));
  expect(packageStep).toContain("id: native-package\n");
  const names = ["Smoke packaged Electron runtime", ...RECOVERY_SCENARIOS.map(scenario => `Verify packaged task recovery (${scenario})`),
    ...(job === "native-windows" ? ["Verify Windows packaged synthetic scale and IME contracts", "Verify Windows NSIS installer lifecycle"] : [])];
  for (const name of names) {
    const step = steps.find(value => value.startsWith(`${name}\n`));
    expect(step).toBeDefined();
    // Explicit status predicate continues after failure, but never after cancellation or failed packaging.
    expect(step).toContain("if: ${{ !cancelled() && steps.native-package.outcome == 'success' }}\n");
    expect(step).not.toContain("continue-on-error:");
  }
  expect(body).not.toContain("continue-on-error: true");
});

it.each([[], ["--"], ["all"], ["agent-before-response", "app-after-tool"], ["--", "--", "agent-before-response"]].map(args => ({ args })))(
  "rejects ambiguous or unbounded scenario arguments $args", ({ args }) => {
    expect(() => selectRecoveryScenario(args)).toThrow("Select exactly one bounded scenario");
  }
);
