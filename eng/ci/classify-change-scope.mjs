import { execFileSync } from "node:child_process";
import { appendFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isWindowsInstallerVerifierProductPath } from "./windows-installer-verifier-scope.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export function classifyChangedPaths(paths) {
  const changedPaths = [...new Set(paths.map(normalizeRepoPath).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  if (changedPaths.length === 0) return fullValidation("empty-diff", changedPaths);
  if (changedPaths.every(isDocumentationPath)) {
    return scopeResult("docs-only", changedPaths, false, false, false, false);
  }

  const productPaths = changedPaths.filter((path) => !isDocumentationPath(path));
  if (productPaths.every(isWindowsInstallerVerifierProductPath)) {
    return scopeResult("windows-installer-verifier-only", changedPaths, false, false, false, false, true);
  }
  if (productPaths.every(isWindowsOnlyPath)) {
    return scopeResult("windows-only", changedPaths, true, true, false, false, false);
  }
  if (productPaths.every(isMacosOnlyPath)) {
    return scopeResult("macos-only", changedPaths, true, false, true, false, false);
  }
  return fullValidation("shared-or-unknown", changedPaths);
}

export function changedPathsBetween(base, head, cwd = repositoryRoot) {
  if (!isCommitId(base) || !isCommitId(head) || /^0+$/u.test(base)) return undefined;
  try {
    execFileSync("git", ["cat-file", "-e", `${base}^{commit}`], { cwd, stdio: "ignore" });
    execFileSync("git", ["cat-file", "-e", `${head}^{commit}`], { cwd, stdio: "ignore" });
    return execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${base}..${head}`],
      { cwd, encoding: "utf8" }
    ).split(/\r?\n/u).filter(Boolean);
  } catch {
    return undefined;
  }
}

export function normalizeRepoPath(path) {
  if (typeof path !== "string") return "";
  return path.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function isDocumentationPath(path) {
  return path.startsWith("docs/")
    || path.endsWith(".md")
    || path.startsWith(".github/ISSUE_TEMPLATE/");
}

function isWindowsOnlyPath(path) {
  return path === "eng/packaging/pi.ico"
    || /^eng\/packaging\/.*windows.*\.(?:mjs|ts|ps1)$/iu.test(path)
    || /^eng\/packaging\/controlled-shutdown-fixture(?:\.test)?\.(?:mjs|ts)$/u.test(path);
}

function isMacosOnlyPath(path) {
  return path === "eng/packaging/entitlements.mac.plist"
    || path === "eng/packaging/pi.icns"
    || /^eng\/packaging\/.*macos.*\.(?:mjs|ts)$/iu.test(path);
}

function fullValidation(reason, paths) {
  return scopeResult(reason, paths, true, true, true, true, false);
}

function scopeResult(reason, paths, runQuality, runWindows, runMacos, full, reuseWindowsInstaller = false) {
  return {
    reason,
    changedPaths: paths,
    runQuality,
    runWindows,
    runMacos,
    fullValidation: full,
    reuseWindowsInstaller
  };
}

function isCommitId(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/iu.test(value);
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Expected --base, --head, and --github-output arguments.");
    }
    values.set(name, value);
  }
  const base = values.get("--base");
  const head = values.get("--head");
  const githubOutput = values.get("--github-output");
  if (!base || !head || !githubOutput || values.size !== 3) {
    throw new Error("Expected exactly --base, --head, and --github-output arguments.");
  }
  return { base, head, githubOutput };
}

async function main() {
  const { base, head, githubOutput } = parseArguments(process.argv.slice(2));
  const root = await realpath(repositoryRoot);
  const changedPaths = changedPathsBetween(base, head, root);
  const result = changedPaths === undefined
    ? fullValidation("unavailable-base", [])
    : classifyChangedPaths(changedPaths);
  await appendFile(resolve(githubOutput), [
    `run_quality=${String(result.runQuality)}`,
    `run_windows=${String(result.runWindows)}`,
    `run_macos=${String(result.runMacos)}`,
    `reuse_windows_installer=${String(result.reuseWindowsInstaller)}`,
    `full_validation=${String(result.fullValidation)}`,
    `scope_reason=${result.reason}`,
    ""
  ].join("\n"), "utf8");
  console.log(JSON.stringify({
    reason: result.reason,
    changedPathCount: result.changedPaths.length,
    runQuality: result.runQuality,
    runWindows: result.runWindows,
    runMacos: result.runMacos,
    reuseWindowsInstaller: result.reuseWindowsInstaller,
    fullValidation: result.fullValidation
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
