import { lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  capabilityTreeSha256,
  isNodeError,
  isRecord,
  readBoundedCapabilityJson,
  replaceCapabilityDirectoryIfChanged
} from "./desktop-capability-file-integrity.js";

export interface DesktopCompatibilityProjection {
  status: "current" | "installed" | "updated" | "user-owned" | "unavailable";
  path?: string;
  treeSha256?: string;
}

export interface DesktopOpenVikingProjection {
  status: "current" | "installed" | "adopted-legacy" | "updated" | "user-owned" | "unavailable";
  path?: string;
  treeSha256?: string;
}

export async function projectCompatibilityExtension(options: {
  source: string;
  destination: string;
  previousHash?: string;
  safePriorHashes?: readonly string[];
  agentDir: string;
  createToken: () => string;
}): Promise<DesktopCompatibilityProjection> {
  let expectedHash: string;
  try {
    expectedHash = await capabilityTreeSha256(options.source);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { status: "unavailable" };
    throw error;
  }
  const currentHash = await readProjectionHash(options.destination);
  if (currentHash === null) return { status: "user-owned", path: options.destination };
  if (currentHash === expectedHash) {
    return { status: "current", path: options.destination, treeSha256: expectedHash };
  }
  const safePriorHashes = new Set(
    [options.previousHash, ...(options.safePriorHashes ?? [])]
      .filter((value): value is string => /^[a-f0-9]{64}$/u.test(value ?? ""))
  );
  if (currentHash !== undefined && !safePriorHashes.has(currentHash)) {
    return { status: "user-owned", path: options.destination, treeSha256: currentHash };
  }
  await replaceCapabilityDirectoryIfChanged({
    source: options.source,
    destination: options.destination,
    expectedHash,
    containmentRoot: options.agentDir,
    createToken: options.createToken
  });
  return {
    status: currentHash === undefined ? "installed" : "updated",
    path: options.destination,
    treeSha256: expectedHash
  };
}

export async function projectSharedOpenVikingExtension(options: {
  source: string;
  destination: string;
  expectedHash: string;
  previousHash?: string;
  agentDir: string;
  createToken: () => string;
}): Promise<DesktopOpenVikingProjection> {
  const legacyHash = await readImportedOpenVikingTreeSha256(options.source);
  const currentHash = await readProjectionHash(options.destination);
  if (currentHash === null) return { status: "user-owned", path: options.destination };
  if (currentHash === options.expectedHash) {
    return { status: "current", path: options.destination, treeSha256: options.expectedHash };
  }
  const safePriorHashes = new Set(
    [legacyHash, options.previousHash].filter((value): value is string => /^[a-f0-9]{64}$/u.test(value ?? ""))
  );
  if (currentHash !== undefined && !safePriorHashes.has(currentHash)) {
    return { status: "user-owned", path: options.destination, treeSha256: currentHash };
  }
  await replaceCapabilityDirectoryIfChanged({
    source: options.source,
    destination: options.destination,
    expectedHash: options.expectedHash,
    containmentRoot: options.agentDir,
    createToken: options.createToken
  });
  return {
    status: currentHash === undefined
      ? "installed"
      : currentHash === legacyHash ? "adopted-legacy" : "updated",
    path: options.destination,
    treeSha256: options.expectedHash
  };
}

async function readProjectionHash(path: string): Promise<string | undefined | null> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) return null;
    return capabilityTreeSha256(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function readImportedOpenVikingTreeSha256(source: string): Promise<string | undefined> {
  const manifest = await readBoundedCapabilityJson(join(source, "package.json"));
  if (!isRecord(manifest) || !isRecord(manifest.pi67DesktopMigration)) return undefined;
  const hash = manifest.pi67DesktopMigration.importedTreeSha256;
  return typeof hash === "string" && /^[a-f0-9]{64}$/u.test(hash) ? hash : undefined;
}
