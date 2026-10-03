import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PackageSource } from "@earendil-works/pi-coding-agent";
import { isSameOrContainedAbsolutePath } from "./desktop-capability-paths.js";

const RETIRED_MCP_ADAPTER_PACKAGE_NAME = "pi-mcp-adapter";
const MAX_LOCAL_PACKAGE_MANIFEST_BYTES = 1_000_000;
type LocalPackageBase = string | readonly string[];

export interface DesktopPackageSettingsLocations {
  readonly agentDir: string;
  readonly cwd: string;
}

export function withoutRetiredMcpAdapterPackages(
  configured: PackageSource[],
  localBase?: LocalPackageBase
): PackageSource[] {
  return configured.filter((entry) => {
    const source = typeof entry === "string" ? entry : entry.source;
    return !isRetiredMcpAdapterSource(source, localBase);
  });
}

export function retiredMcpAdapterPackageRoots(
  configured: PackageSource[],
  localBase?: LocalPackageBase
): string[] {
  return [...new Set(configured.flatMap((entry) => {
    const source = typeof entry === "string" ? entry : entry.source;
    const root = retiredMcpAdapterPackageRoot(source, localBase);
    return root === undefined ? [] : [root];
  }))];
}

export function withoutRetiredMcpAdapterExtensions(
  configured: string[],
  roots: string[],
  localBase?: string
): string[] {
  if (roots.length === 0) return configured;
  return configured.filter((entry) => {
    const path = localConfiguredPath(entry, localBase);
    return path === undefined || !roots.some((root) => isSameOrContainedAbsolutePath(path, root));
  });
}

export function desktopPackageSettingsScopeDirectory(
  locations: DesktopPackageSettingsLocations | undefined,
  scope: "global" | "project"
): string | undefined {
  if (!locations) return undefined;
  return scope === "global" ? resolve(locations.agentDir) : resolve(locations.cwd, ".pi");
}

export function desktopPackageSettingsScopeDirectories(
  locations: DesktopPackageSettingsLocations | undefined
): string[] {
  return locations === undefined ? [] : [
    desktopPackageSettingsScopeDirectory(locations, "global")!,
    desktopPackageSettingsScopeDirectory(locations, "project")!
  ];
}

function isRetiredMcpAdapterSource(source: string, localBase?: LocalPackageBase): boolean {
  const normalized = source.trim();
  if (/^npm:pi-mcp-adapter(?:@[^/]+)?$/u.test(normalized)) return true;
  return retiredMcpAdapterPackageRoot(normalized, localBase) !== undefined;
}

function retiredMcpAdapterPackageRoot(source: string, localBase?: LocalPackageBase): string | undefined {
  const path = source.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
  if (/\/desktop-capabilities\/managed-packages\/(?:active|bundled|previous|staging)\/packages\/pi-mcp-adapter(?:\/package\.json)?$/u.test(path)) {
    return path.endsWith("/package.json") ? dirname(path) : path;
  }
  for (const base of localPackageBases(localBase)) {
    const root = localPackageRoot(source, base);
    if (root !== undefined && localPackageName(root) === RETIRED_MCP_ADAPTER_PACKAGE_NAME) return root;
  }
  return undefined;
}

function localPackageBases(localBase?: LocalPackageBase): readonly (string | undefined)[] {
  if (localBase === undefined) return [undefined];
  return typeof localBase === "string" ? [localBase] : localBase;
}

function localPackageRoot(source: string, localBase?: string): string | undefined {
  const path = localConfiguredPath(source, localBase);
  if (path === undefined) return undefined;
  return basename(path) === "package.json" ? dirname(path) : path;
}

function localConfiguredPath(source: string, localBase?: string): string | undefined {
  try {
    const normalized = source.trim();
    if (normalized.startsWith("file:")) return resolve(fileURLToPath(normalized));
    if (normalized === "~" || normalized.startsWith("~/") || normalized.startsWith("~\\")) {
      return resolve(configuredHomeDirectory(), normalized === "~" ? "" : normalized.slice(2));
    }
    if (isAbsolute(normalized)) return resolve(normalized);
    if (localBase !== undefined && isPiLocalPathSource(normalized)) {
      return resolve(localBase, normalized);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function isPiLocalPathSource(source: string): boolean {
  return !/^(?:npm:|git:|git\+|git@|github:|https?:|ssh:|builtin:)/iu.test(source);
}

function configuredHomeDirectory(): string {
  return nonEmpty(process.env.HOME) ?? nonEmpty(process.env.USERPROFILE) ?? homedir();
}

function localPackageName(root: string): string | undefined {
  try {
    const manifest = join(root, "package.json");
    const metadata = lstatSync(manifest);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_LOCAL_PACKAGE_MANIFEST_BYTES) {
      return undefined;
    }
    const value = JSON.parse(readFileSync(manifest, "utf8")) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      && typeof (value as Record<string, unknown>).name === "string"
      ? (value as Record<string, string>).name
      : undefined;
  } catch {
    return undefined;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
