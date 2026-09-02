import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { PackageSource, SettingsManager } from "@earendil-works/pi-coding-agent";

export type DesktopMemoryOwnerPreflightState =
  | "not-configured"
  | "single-owner"
  | "conflict";

export type DesktopMemoryOwnerCandidateSource =
  | "global-package"
  | "project-package"
  | "global-extension"
  | "project-extension"
  | "managed-extension";

export interface DesktopMemoryOwnerCandidate {
  id: string;
  displayName: string;
  source: DesktopMemoryOwnerCandidateSource;
  location: string;
  extensionPaths: string[];
}

export interface DesktopMemoryOwnerPreflight {
  state: DesktopMemoryOwnerPreflightState;
  candidates: DesktopMemoryOwnerCandidate[];
  reservedOwner?: "pi67-openviking";
  selectedOwner?: string;
  retiredOwners: string[];
  blockedOwners: string[];
  blockedPackageSources: string[];
  blockedGlobalExtensionPaths: string[];
  blockedProjectExtensionPaths: string[];
  blockedManagedExtensionPaths: string[];
}

interface MemoryOwnerPreflightOptions {
  cwd: string;
  agentDir: string;
  settingsManager?: Pick<
    SettingsManager,
    "getGlobalSettings" | "getProjectSettings" | "isProjectTrusted"
  >;
  managedExtensionPaths?: readonly string[];
  reservedOwner?: "pi67-openviking";
}

interface ExtensionSettingsSnapshot {
  packages?: PackageSource[];
  extensions?: string[];
}

const RETIRED_MEMORY_OWNER_IDS = new Set([
  "pi-observational-memory",
  "pi-hy-memory"
]);

/**
 * Resolve the third-party Context/Memory owners that Pi would attempt to load
 * for one new Session. Retired owners are always blocked. The result is
 * immutable for that Session: duplicate eligible OpenViking owners block every
 * Memory extension while leaving Pi and its built-in compaction available.
 */
export function inspectDesktopMemoryOwners(
  options: MemoryOwnerPreflightOptions
): DesktopMemoryOwnerPreflight {
  const candidates: DesktopMemoryOwnerCandidate[] = [];
  const settingsManager = options.settingsManager;
  if (settingsManager) {
    const globalSettings = settingsManager.getGlobalSettings();
    candidates.push(
      ...packageCandidates(globalSettings.packages ?? [], "global-package"),
      ...localExtensionCandidates(
        options.agentDir,
        join(options.agentDir, "extensions"),
        globalSettings,
        "global-extension"
      )
    );
    if (settingsManager.isProjectTrusted()) {
      const projectBase = join(options.cwd, ".pi");
      const projectSettings = settingsManager.getProjectSettings();
      candidates.push(
        ...packageCandidates(projectSettings.packages ?? [], "project-package"),
        ...localExtensionCandidates(
          projectBase,
          join(projectBase, "extensions"),
          projectSettings,
          "project-extension"
        )
      );
    }
  }
  for (const extensionPath of options.managedExtensionPaths ?? []) {
    const id = memoryOwnerId(extensionPath);
    if (!id) continue;
    candidates.push({
      id,
      displayName: memoryOwnerDisplayName(extensionPath, id),
      source: "managed-extension",
      location: resolve(extensionPath),
      extensionPaths: [resolve(extensionPath)]
    });
  }

  const distinctCandidates = deduplicateCandidates(candidates);
  const retiredCandidates = distinctCandidates.filter((candidate) => (
    RETIRED_MEMORY_OWNER_IDS.has(candidate.id)
  ));
  const eligibleCandidates = distinctCandidates.filter((candidate) => (
    !RETIRED_MEMORY_OWNER_IDS.has(candidate.id)
  ));
  const state: DesktopMemoryOwnerPreflightState = eligibleCandidates.length === 0
    ? "not-configured"
    : eligibleCandidates.length === 1 ? "single-owner" : "conflict";
  const blockedCandidates = state === "conflict" ? distinctCandidates : retiredCandidates;
  const blockedPackageSources = blockedCandidates.flatMap((candidate) => (
    candidate.source === "global-package" || candidate.source === "project-package"
      ? [candidate.location]
      : []
  ));
  const blockedGlobalExtensionPaths = extensionPathsFor(
    blockedCandidates,
    "global-extension",
    options.agentDir
  );
  const projectBase = join(options.cwd, ".pi");
  const blockedProjectExtensionPaths = extensionPathsFor(
    blockedCandidates,
    "project-extension",
    projectBase
  );
  const blockedManagedExtensionPaths = blockedCandidates.flatMap((candidate) => (
    candidate.source === "managed-extension" ? candidate.extensionPaths : []
  ));
  return {
    state,
    candidates: distinctCandidates,
    ...(options.reservedOwner === undefined
      ? {}
      : { reservedOwner: options.reservedOwner }),
    ...(state === "single-owner" ? { selectedOwner: eligibleCandidates[0]!.id } : {}),
    retiredOwners: [...new Set(retiredCandidates.map((candidate) => candidate.displayName))]
      .sort((left, right) => left.localeCompare(right)),
    blockedOwners: [...new Set(blockedCandidates.map((candidate) => candidate.displayName))]
      .sort((left, right) => left.localeCompare(right)),
    blockedPackageSources: [...new Set(blockedPackageSources)],
    blockedGlobalExtensionPaths,
    blockedProjectExtensionPaths,
    blockedManagedExtensionPaths: [...new Set(
      blockedManagedExtensionPaths.map((path) => resolve(path))
    )]
  };
}

export function applyMemoryOwnerPackageGate(
  configured: PackageSource[],
  preflight: DesktopMemoryOwnerPreflight | undefined
): PackageSource[] {
  if (!preflight || preflight.blockedPackageSources.length === 0) return configured;
  const blocked = new Set(preflight.blockedPackageSources);
  return configured.map((entry) => {
    const source = packageSource(entry);
    if (!blocked.has(source)) return entry;
    return typeof entry === "string"
      ? { source: entry, extensions: [] }
      : { ...entry, extensions: [] };
  });
}

export function applyMemoryOwnerExtensionGate(
  configured: string[],
  scope: "global" | "project",
  preflight: DesktopMemoryOwnerPreflight | undefined
): string[] {
  if (!preflight) return configured;
  const blocked = scope === "global"
    ? preflight.blockedGlobalExtensionPaths
    : preflight.blockedProjectExtensionPaths;
  return [...new Set([...configured, ...blocked.map((path) => `-${path}`)])];
}

export function applyManagedMemoryOwnerGate(
  configured: string[],
  preflight: DesktopMemoryOwnerPreflight | undefined
): string[] {
  if (!preflight) return configured;
  const blocked = new Set(
    preflight.blockedManagedExtensionPaths.map((path) => resolve(path))
  );
  return configured.filter((path) => !blocked.has(resolve(path)));
}

export function memoryOwnerId(value: string): string | undefined {
  const normalized = value.trim().toLowerCase().replaceAll("\\", "/");
  if (normalized.includes("pi-observational-memory")) return "pi-observational-memory";
  if (normalized.includes("pi-hy-memory")) return "pi-hy-memory";
  if (!normalized.includes("openviking")) return undefined;
  const segment = normalized
    .split("/")
    .map((entry) => entry.replace(/^npm:/u, ""))
    .findLast((entry) => entry.includes("openviking"));
  if (!segment) return "openviking";
  const withoutVersion = segment.replace(/@(?:\^|~)?\d[^/]*$/u, "");
  if (withoutVersion === "openviking-pi-extension") return "pi67-openviking";
  return withoutVersion.replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "openviking";
}

function packageCandidates(
  configured: PackageSource[],
  source: "global-package" | "project-package"
): DesktopMemoryOwnerCandidate[] {
  return configured.flatMap((entry) => {
    if (!packageExtensionEnabled(entry)) return [];
    const location = packageSource(entry);
    const id = memoryOwnerId(location);
    return id
      ? [{
          id,
          displayName: memoryOwnerDisplayName(location, id),
          source,
          location,
          extensionPaths: []
        }]
      : [];
  });
}

function localExtensionCandidates(
  baseDir: string,
  extensionRoot: string,
  settings: ExtensionSettingsSnapshot,
  source: "global-extension" | "project-extension"
): DesktopMemoryOwnerCandidate[] {
  if (!existsSync(extensionRoot)) return [];
  const candidates: DesktopMemoryOwnerCandidate[] = [];
  for (const entry of safeDirectoryEntries(extensionRoot)) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const entryPath = join(extensionRoot, entry);
    const id = memoryOwnerId(entryPath);
    if (!id) continue;
    const extensionPaths = resolveExtensionEntries(entryPath)
      .filter((path) => extensionEnabled(path, settings.extensions ?? [], baseDir));
    if (extensionPaths.length === 0) continue;
    candidates.push({
      id,
      displayName: memoryOwnerDisplayName(entryPath, id),
      source,
      location: resolve(entryPath),
      extensionPaths
    });
  }
  return candidates;
}

function resolveExtensionEntries(path: string): string[] {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return [];
  }
  if (stats.isFile()) {
    return path.endsWith(".ts") || path.endsWith(".js") ? [resolve(path)] : [];
  }
  if (!stats.isDirectory()) return [];

  const manifestPath = join(path, "package.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        pi?: { extensions?: unknown };
      };
      if (Array.isArray(manifest.pi?.extensions)) {
        const entries = manifest.pi.extensions.flatMap((entry) => {
          if (typeof entry !== "string" || isOverridePattern(entry)) return [];
          const resolvedEntry = resolve(path, entry);
          return existsSync(resolvedEntry) ? [resolvedEntry] : [];
        });
        if (entries.length > 0) return entries;
      }
    } catch {
      // Pi will report a malformed package later; preflight only uses readable entries.
    }
  }
  for (const indexName of ["index.ts", "index.js"]) {
    const indexPath = join(path, indexName);
    if (existsSync(indexPath)) return [resolve(indexPath)];
  }
  return [];
}

function extensionEnabled(path: string, patterns: string[], baseDir: string): boolean {
  const overrides = patterns.filter(isOverridePattern);
  const excludes = overrides.filter((pattern) => pattern.startsWith("!"));
  const includes = overrides.filter((pattern) => pattern.startsWith("+"));
  const forceExcludes = overrides.filter((pattern) => pattern.startsWith("-"));
  let enabled = !excludes.some((pattern) => pathMatches(path, pattern.slice(1), baseDir));
  if (includes.some((pattern) => exactPathMatches(path, pattern.slice(1), baseDir))) enabled = true;
  if (forceExcludes.some((pattern) => exactPathMatches(path, pattern.slice(1), baseDir))) enabled = false;
  return enabled;
}

function pathMatches(path: string, pattern: string, baseDir: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const candidates = [
    normalizePath(relative(baseDir, path)),
    normalizePath(path),
    basename(path)
  ];
  const expression = new RegExp(`^${escapePattern(normalizedPattern)}$`, "u");
  return candidates.some((candidate) => expression.test(candidate));
}

function exactPathMatches(path: string, pattern: string, baseDir: string): boolean {
  const normalizedPattern = normalizePath(pattern.replace(/^\.\//u, ""));
  return normalizedPattern === normalizePath(relative(baseDir, path))
    || normalizedPattern === normalizePath(path);
}

function escapePattern(pattern: string): string {
  let result = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*") {
      const next = pattern[index + 1];
      if (next === "*") {
        result += ".*";
        index += 1;
      } else {
        result += "[^/]*";
      }
    } else if (character === "?") {
      result += "[^/]";
    } else {
      result += character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    }
  }
  return result;
}

function packageExtensionEnabled(entry: PackageSource): boolean {
  if (typeof entry === "string") return true;
  if (entry.extensions !== undefined) {
    if (entry.extensions.length === 0) return false;
    if (entry.autoload === false) {
      return entry.extensions.some((pattern) => !pattern.startsWith("!") && !pattern.startsWith("-"));
    }
    return true;
  }
  return entry.autoload !== false;
}

function extensionPathsFor(
  candidates: DesktopMemoryOwnerCandidate[],
  source: "global-extension" | "project-extension",
  baseDir: string
): string[] {
  return [...new Set(candidates
    .filter((candidate) => candidate.source === source)
    .flatMap((candidate) => candidate.extensionPaths)
    .map((path) => normalizePath(relative(baseDir, path))))];
}

function deduplicateCandidates(
  candidates: DesktopMemoryOwnerCandidate[]
): DesktopMemoryOwnerCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.source}:${normalizePath(candidate.location)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function packageSource(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

function memoryOwnerDisplayName(value: string, fallback: string): string {
  if (fallback === "pi-observational-memory" || fallback === "pi-hy-memory") {
    return fallback;
  }
  const normalized = value.replaceAll("\\", "/").replace(/\/$/u, "");
  const name = normalized.split("/").findLast((entry) => entry.length > 0);
  return name?.replace(/@(?:\^|~)?\d[^/]*$/u, "") || fallback;
}

function safeDirectoryEntries(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isOverridePattern(value: string): boolean {
  return value.startsWith("!") || value.startsWith("+") || value.startsWith("-");
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}
