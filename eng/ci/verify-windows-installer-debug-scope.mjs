import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  changedPathsBetween,
  normalizeRepoPath
} from "./classify-change-scope.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const ALLOWED_PACKAGING_BASENAMES = new Set([
  "controlled-shutdown-fixture.ts",
  "controlled-shutdown-fixture.test.mjs",
  "packaged-electron-fixture.mjs",
  "packaged-electron-smoke-scenarios.mjs",
  "verify-windows-installer-lifecycle.mjs",
  "verify-windows-installer-lifecycle.test.mjs",
  "windows-artifact-identity.mjs",
  "windows-artifact-identity.test.mjs",
  "windows-installed-application-lifecycle.mjs",
  "windows-installer-identity.mjs"
]);

export function verifyWindowsInstallerDebugScope(paths) {
  const rejected = paths.map(normalizeRepoPath).filter((path) => !isAllowedPath(path));
  if (rejected.length > 0) {
    throw new Error(`Windows installer artifact reuse rejected changed paths: ${rejected.join(", ")}`);
  }
}

export function verifySourceRunMetadata(metadata, sourceSha) {
  if (
    metadata?.head_sha !== sourceSha
    || metadata?.status !== "completed"
    || metadata?.conclusion !== "failure"
    || typeof metadata?.path !== "string"
    || !metadata.path.startsWith(".github/workflows/ci.yml")
  ) throw new Error("Source run is not a completed failed CI run for the requested SHA.");
}

function isAllowedPath(path) {
  if (path.startsWith("docs/") || path.endsWith(".md")) return true;
  if (!path.startsWith("eng/packaging/")) return false;
  return ALLOWED_PACKAGING_BASENAMES.has(path.slice("eng/packaging/".length));
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error("Invalid debug scope arguments.");
    values.set(name, value);
  }
  const base = values.get("--base");
  const head = values.get("--head");
  const runMetadata = values.get("--run-metadata");
  if (!base || !head || !runMetadata || values.size !== 3) {
    throw new Error("Expected exactly --base, --head, and --run-metadata.");
  }
  return { base, head, runMetadata };
}

async function main() {
  const { base, head, runMetadata } = parseArguments(process.argv.slice(2));
  if (!/^[a-f0-9]{40}$/iu.test(base) || !/^[a-f0-9]{40}$/iu.test(head)) {
    throw new Error("Debug source and verifier refs must resolve to full Git commit IDs.");
  }
  const metadata = JSON.parse(await readFile(resolve(runMetadata), "utf8"));
  verifySourceRunMetadata(metadata, base);
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", base, head], {
      cwd: repositoryRoot,
      stdio: "ignore"
    });
  } catch {
    throw new Error("The debug verifier ref must descend from the artifact source SHA.");
  }
  const paths = changedPathsBetween(base, head, repositoryRoot);
  if (paths === undefined) throw new Error("Unable to resolve the debug verifier diff.");
  verifyWindowsInstallerDebugScope(paths);
  console.log(JSON.stringify({ sourceSha: base, verifierSha: head, changedPathCount: paths.length }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
