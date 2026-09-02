import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  safeAtomicReplaceFile,
  setDesktopManagedPackagesDocument,
  type DesktopManagedPackageDocumentEntry
} from "@pi67/pi-runtime";
import {
  capabilityTreeSha256,
  containedCapabilityPath,
  copyCapabilityDirectory,
  isContainedPath,
  isNodeError,
  isRecord,
  readBoundedCapabilityJson
} from "./desktop-capability-file-integrity.js";

const SHARED_PROFILE_RECEIPT_SCHEMA = "pi67.shared-profile-receipt.v1";
const MAX_SETTINGS_BYTES = 1_000_000;

export interface SharedProfilePackage {
  id: string;
  displayName: string;
  source: string;
  packagePath: string;
  treeSha256: string;
  includeNodeModules: boolean;
}

export interface DesktopSharedProfileProjection {
  status: "current" | "installed" | "updated";
  root: string;
  receiptPath: string;
}

export async function activateSharedProfile(options: {
  agentDir: string;
  managedRoot: string;
  catalogVersion: string;
  packages: SharedProfilePackage[];
  createToken: () => string;
}): Promise<DesktopSharedProfileProjection> {
  const root = join(options.managedRoot, "shared-profile");
  const active = join(root, "active");
  const previous = join(root, "previous");
  const stagingRoot = join(root, "staging");
  const receiptPath = join(active, "receipt.json");
  const inspection = await inspectSharedProfile(active);
  if (inspection.status === "invalid") {
    throw new Error(`Desktop shared profile is invalid: ${inspection.detail}`);
  }
  const expected = sharedProfileReceipt(options.catalogVersion, options.packages);
  const current = inspection.status === "valid"
    && sharedProfileReceiptMatches(inspection.receipt, expected);
  const settingsPath = join(options.agentDir, "settings.json");
  const settingsBefore = await readOptionalSettings(settingsPath);
  const settingsAfter = setDesktopManagedPackagesDocument(
    settingsBefore.content,
    options.managedRoot,
    sharedProfileTuiPackages(active, options.packages)
  );

  if (current) {
    await writeSettingsIfChanged(settingsPath, settingsBefore, settingsAfter, options.createToken);
    return { status: "current", root: active, receiptPath };
  }

  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  const staging = join(stagingRoot, `${process.pid}-${options.createToken()}`);
  if (!isContainedPath(staging, root)) throw new Error("Shared profile staging path escaped its root.");
  let staged = false;
  let backedUp = false;
  let activated = false;
  try {
    await mkdir(join(staging, "packages"), { recursive: true, mode: 0o700 });
    staged = true;
    for (const entry of options.packages) {
      const destination = containedCapabilityPath(staging, entry.packagePath, "Shared profile Package path");
      await copyCapabilityDirectory(entry.source, destination, entry.source, entry.includeNodeModules);
      if (await capabilityTreeSha256(destination, entry.includeNodeModules) !== entry.treeSha256) {
        throw new Error(`Desktop shared profile ${entry.id} failed staging integrity verification.`);
      }
    }
    await writeFile(join(staging, "receipt.json"), `${JSON.stringify(expected, null, 2)}\n`, { mode: 0o600 });
    const stagedInspection = await inspectSharedProfile(staging);
    if (
      stagedInspection.status !== "valid"
      || !sharedProfileReceiptMatches(stagedInspection.receipt, expected)
    ) throw new Error("Desktop shared profile staging receipt failed verification.");

    await rm(previous, { recursive: true, force: true });
    try {
      await rename(active, previous);
      backedUp = true;
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    await rename(staging, active);
    staged = false;
    activated = true;
    if (process.platform !== "win32") await chmod(root, 0o700);
    await writeSettingsIfChanged(settingsPath, settingsBefore, settingsAfter, options.createToken);
    return {
      status: inspection.status === "absent" ? "installed" : "updated",
      root: active,
      receiptPath
    };
  } catch (error) {
    if (activated) await rm(active, { recursive: true, force: true }).catch(() => undefined);
    if (backedUp) await rename(previous, active).catch(() => undefined);
    throw error;
  } finally {
    if (staged) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

function sharedProfileReceipt(catalogVersion: string, packages: SharedProfilePackage[]) {
  return {
    schema: SHARED_PROFILE_RECEIPT_SCHEMA,
    catalogVersion,
    packages: packages.map((entry) => ({
      id: entry.id,
      packagePath: entry.packagePath,
      treeSha256: entry.treeSha256,
      includeNodeModules: entry.includeNodeModules
    }))
  };
}

function sharedProfileTuiPackages(
  activeRoot: string,
  packages: SharedProfilePackage[]
): DesktopManagedPackageDocumentEntry[] {
  const result: DesktopManagedPackageDocumentEntry[] = [];
  for (const entry of packages) {
    if (entry.id === "openviking-pi-extension") continue;
    const source = join(activeRoot, entry.packagePath);
    result.push(entry.id === "pi-workspace-resources"
      ? { source, extensions: [] }
      : source);
  }
  return result;
}

type SharedProfileReceipt = ReturnType<typeof sharedProfileReceipt>;

async function inspectSharedProfile(root: string): Promise<
  | { status: "absent" }
  | { status: "invalid"; detail: string }
  | { status: "valid"; receipt: SharedProfileReceipt }
> {
  try {
    const metadata = await lstat(root);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      return { status: "invalid", detail: "active root is not a real directory" };
    }
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { status: "absent" };
    throw error;
  }
  let value: unknown;
  try {
    value = await readBoundedCapabilityJson(join(root, "receipt.json"));
  } catch (error) {
    return { status: "invalid", detail: error instanceof Error ? error.message : "receipt is unavailable" };
  }
  if (!isSharedProfileReceiptShape(value)) {
    return { status: "invalid", detail: "receipt schema is invalid" };
  }
  const packages: SharedProfileReceipt["packages"] = [];
  for (const candidate of value.packages) {
    if (!isSharedProfilePackageReceipt(candidate)) {
      return { status: "invalid", detail: "receipt Package entry is invalid" };
    }
    const packageRoot = containedCapabilityPath(root, candidate.packagePath, "Shared profile receipt Package path");
    try {
      if (await capabilityTreeSha256(packageRoot, candidate.includeNodeModules) !== candidate.treeSha256) {
        return { status: "invalid", detail: `Package ${candidate.id} failed integrity verification` };
      }
    } catch (error) {
      return { status: "invalid", detail: error instanceof Error ? error.message : `Package ${candidate.id} is unavailable` };
    }
    packages.push({ ...candidate });
  }
  return {
    status: "valid",
    receipt: {
      schema: SHARED_PROFILE_RECEIPT_SCHEMA,
      catalogVersion: value.catalogVersion,
      packages
    }
  };
}

function isSharedProfileReceiptShape(value: unknown): value is {
  schema: typeof SHARED_PROFILE_RECEIPT_SCHEMA;
  catalogVersion: string;
  packages: unknown[];
} {
  return isRecord(value)
    && value.schema === SHARED_PROFILE_RECEIPT_SCHEMA
    && typeof value.catalogVersion === "string"
    && Array.isArray(value.packages)
    && value.packages.length > 0
    && value.packages.length <= 32;
}

function isSharedProfilePackageReceipt(value: unknown): value is SharedProfileReceipt["packages"][number] {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.packagePath === "string"
    && typeof value.treeSha256 === "string"
    && /^[a-f0-9]{64}$/u.test(value.treeSha256)
    && typeof value.includeNodeModules === "boolean";
}

function sharedProfileReceiptMatches(left: SharedProfileReceipt, right: SharedProfileReceipt): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface OptionalSettingsSnapshot {
  content: string | undefined;
  revision: string;
}

async function readOptionalSettings(path: string): Promise<OptionalSettingsSnapshot> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_SETTINGS_BYTES) {
      throw new Error("Pi settings.json must be a bounded regular file.");
    }
    const content = await readFile(path, "utf8");
    return { content, revision: sha256Text(content) };
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { content: undefined, revision: "absent" };
    throw error;
  }
}

async function writeSettingsIfChanged(
  path: string,
  before: OptionalSettingsSnapshot,
  content: string,
  createToken: () => string
): Promise<void> {
  if (content === before.content) return;
  await safeAtomicReplaceFile(path, content, {
    mode: 0o600,
    createToken,
    beforeCommit: async () => {
      const current = await readOptionalSettings(path);
      if (current.revision !== before.revision) {
        throw new Error("Pi settings.json changed externally during shared profile activation.");
      }
    }
  });
}

function sha256Text(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
