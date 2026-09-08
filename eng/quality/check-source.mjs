import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function sourceCheckScripts(candidate) {
  return candidate
    ? ["check:dependencies", "verify:capability-source-lock", "check:capability-freshness", "verify:extension-adapters", "check"]
    : ["check"];
}

export function runSourceChecks({ candidate = false, run = spawnSync, env = process.env } = {}) {
  for (const script of sourceCheckScripts(candidate)) {
    const result = run(process.platform === "win32" ? "corepack.cmd" : "corepack", ["pnpm", "run", script], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...env, VITEST_MAX_WORKERS: "2" },
      stdio: "inherit",
      // Windows command shims require cmd.exe; argv contains only fixed script names.
      shell: process.platform === "win32"
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Source check ${script} failed (${result.status ?? result.signal}).`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--candidate")) throw new Error("Only --candidate is supported.");
  runSourceChecks({ candidate: args[0] === "--candidate" });
}
