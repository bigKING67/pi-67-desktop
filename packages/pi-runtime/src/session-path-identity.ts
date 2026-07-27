import { resolve } from "node:path";

const SESSION_CATALOG_SOURCE_KEY_VERSION = "session-catalog-source-v2";

export function normalizeSessionCatalogPathIdentity(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function versionSessionCatalogSourceIdentity(identity: string): string {
  return `${SESSION_CATALOG_SOURCE_KEY_VERSION}\0${identity}`;
}
