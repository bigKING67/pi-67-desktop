import { realpath } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
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
  const resolved = normalizeSessionCatalogPathIdentity(path);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
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
