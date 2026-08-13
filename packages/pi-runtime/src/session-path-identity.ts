import { realpath } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, win32 } from "node:path";
import { promisify } from "node:util";

const SESSION_CATALOG_SOURCE_KEY_VERSION = "session-catalog-source-v3";
const realpathNative = promisify(realpath.native);

export function normalizeSessionCatalogPathIdentity(path: string): string {
  return resolve(path);
}

export function normalizeSessionCatalogWorkspaceIdentity(
  path: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform !== "win32") return normalizeSessionCatalogPathIdentity(path);
  return normalizeWindowsFilesystemPathSpelling(win32.resolve(path));
}

export function normalizeWindowsFilesystemPathSpelling(path: string): string {
  const normalized = path.normalize("NFC").replaceAll("/", "\\");
  const extendedUncPrefix = "\\\\?\\UNC\\";
  const extendedPrefix = "\\\\?\\";
  if (normalized.toUpperCase().startsWith(extendedUncPrefix.toUpperCase())) {
    return `\\\\${normalized.slice(extendedUncPrefix.length)}`.toLowerCase();
  }
  const withoutNamespace = normalized.startsWith(extendedPrefix)
    ? normalized.slice(extendedPrefix.length)
    : normalized;
  return withoutNamespace.toLowerCase();
}

export function versionSessionCatalogSourceIdentity(identity: string): string {
  return `${SESSION_CATALOG_SOURCE_KEY_VERSION}\0${identity}`;
}

export async function resolveExistingSessionFileIdentity(path: string): Promise<string> {
  const canonicalPath = await realpathNative(resolve(path));
  const metadata = await stat(canonicalPath, { bigint: true });
  if (metadata.dev !== 0n && metadata.ino !== 0n) {
    return [
      "session-file-v1",
      metadata.dev.toString(10),
      metadata.ino.toString(10),
      metadata.birthtimeNs.toString(10)
    ].join("\0");
  }
  return `session-file-path-v1\0${canonicalPath}`;
}
