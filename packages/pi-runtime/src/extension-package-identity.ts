import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { Extension, SourceInfo } from "@earendil-works/pi-coding-agent";
import {
  isValidExtensionPackageName,
  isValidInstalledExtensionVersion
} from "@pi67/extension-compat";

const MAX_PACKAGE_MANIFEST_BYTES = 64 * 1024;

type PackageExtension = Pick<Extension, "path" | "resolvedPath" | "sourceInfo">;

export interface ResolvedExtensionPackageIdentity {
  readonly name: string;
  readonly version: string;
  readonly baseDir: string;
  readonly source: string;
  readonly scope: SourceInfo["scope"];
  readonly evidence: "pi-resolved-package-manifest";
}

export async function resolveExtensionPackageIdentity(
  extension: PackageExtension
): Promise<ResolvedExtensionPackageIdentity | undefined> {
  const sourceInfo = extension.sourceInfo;
  if (sourceInfo.origin !== "package" || !sourceInfo.baseDir || !isAbsolute(sourceInfo.baseDir)) return undefined;
  try {
    const baseDir = await realpath(sourceInfo.baseDir);
    const extensionPath = extension.resolvedPath || extension.path || sourceInfo.path;
    if (!isAbsolute(extensionPath) || !isContained(await realpath(extensionPath), baseDir)) return undefined;
    const manifestPath = join(baseDir, "package.json");
    const info = await lstat(manifestPath);
    if (info.isSymbolicLink() || !info.isFile() || info.nlink > 1 || info.size > MAX_PACKAGE_MANIFEST_BYTES) {
      return undefined;
    }
    const bytes = await readFile(manifestPath);
    if (bytes.byteLength > MAX_PACKAGE_MANIFEST_BYTES) return undefined;
    const manifest = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!isPlainRecord(manifest)) return undefined;
    const name = manifest.name;
    const version = manifest.version;
    if (typeof name !== "string"
      || typeof version !== "string"
      || !isValidExtensionPackageName(name)
      || !isValidInstalledExtensionVersion(version)
      || !matchesConfiguredNpmSource(name, sourceInfo.source)) return undefined;
    return Object.freeze({
      name,
      version,
      baseDir,
      source: sourceInfo.source,
      scope: sourceInfo.scope,
      evidence: "pi-resolved-package-manifest"
    });
  } catch {
    return undefined;
  }
}

function matchesConfiguredNpmSource(packageName: string, source: string): boolean {
  if (!source.startsWith("npm:")) return true;
  const spec = source.slice("npm:".length).trim();
  const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/u);
  return (match?.[1] ?? spec) === packageName;
}

function isContained(candidate: string, root: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === ""
    || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
