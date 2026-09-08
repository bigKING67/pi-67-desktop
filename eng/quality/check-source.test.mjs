import { expect, it, vi } from "vitest";
import { runSourceChecks, sourceCheckScripts } from "./check-source.mjs";

it("uses the same fixed worker count for local and CI validation", () => {
  const run = vi.fn(() => ({ status: 0 }));
  runSourceChecks({ run, env: { VITEST_MAX_WORKERS: "99", CI: "true" } });
  expect(run).toHaveBeenCalledOnce();
  expect(run.mock.calls[0][1]).toEqual(["pnpm", "run", "check"]);
  expect(run.mock.calls[0][2].env).toEqual({ VITEST_MAX_WORKERS: "2", CI: "true" });
});

it("stops at the first failed gate instead of continuing candidate checks", () => {
  const run = vi.fn(() => ({ status: 1 }));
  expect(() => runSourceChecks({ candidate: true, run })).toThrow("check:dependencies failed");
  expect(run).toHaveBeenCalledOnce();
});

it("runs all candidate prerequisites without launching a build or upload", () => {
  const run = vi.fn(() => ({ status: 0 }));
  runSourceChecks({ candidate: true, run });
  expect(run.mock.calls.map((call) => call[1][2])).toEqual(sourceCheckScripts(true));
  expect(sourceCheckScripts(true)).toEqual(["check:dependencies", "verify:capability-source-lock", "check:capability-freshness", "verify:extension-adapters", "check"]);
});
