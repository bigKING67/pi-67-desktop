import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SANDBOX_PRELOAD_MODULES = new Set([
  "electron",
  "events",
  "node:events",
  "node:timers",
  "node:url",
  "timers",
  "url"
]);

export function findUnsupportedSandboxPreloadModules(source) {
  const modules = new Set();
  const requireCall = /\brequire\(\s*(["'])([^"']+)\1\s*\)/gu;
  for (const match of source.matchAll(requireCall)) {
    const moduleId = match[2];
    if (moduleId && !SANDBOX_PRELOAD_MODULES.has(moduleId)) modules.add(moduleId);
  }
  return [...modules].sort((left, right) => left.localeCompare(right));
}

export async function verifySandboxPreloadBundle(path) {
  const source = await readFile(path, "utf8");
  const unsupported = findUnsupportedSandboxPreloadModules(source);
  if (unsupported.length > 0) {
    throw new Error(
      `Sandbox preload bundle contains unsupported runtime modules: ${unsupported.join(", ")}. `
      + "Bundle workspace dependencies into preload.cjs instead of requiring them at runtime."
    );
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const bundlePath = process.argv[2];
  if (!bundlePath) throw new Error("Expected the sandbox preload bundle path.");
  await verifySandboxPreloadBundle(resolve(bundlePath));
  console.log(`Verified sandbox preload bundle: ${bundlePath}.`);
}
