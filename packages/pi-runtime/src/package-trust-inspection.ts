import { createHash } from "node:crypto";
import { lstat, opendir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionPackageIntegrityReason } from "@pi67/domain";
import type { ExtensionPackageObservation } from "./package-mutation-receipt-store.js";

const MAX_PACKAGE_MANIFEST_BYTES = 1_000_000;
const MAX_PACKAGE_CONTENT_FILES = 10_000;
const MAX_PACKAGE_CONTENT_BYTES = 128 * 1024 * 1024;
const MAX_PACKAGE_CONTENT_DEPTH = 32;
const MAX_PACKAGE_INSPECTION_MS = 5_000;
const EXCLUDED_CONTENT_DIRECTORIES = new Set([".git", "node_modules"]);

interface SafeObservation {
  status: "observed";
  observation: ExtensionPackageObservation;
}

interface FailedObservation {
  status: "unavailable";
  reason: Extract<ExtensionPackageIntegrityReason,
    "install-content-missing" | "receipt-invalid" | "inspection-limited">;
}

export type PackageObservationResult = SafeObservation | FailedObservation;

export async function inspectPackageInstallation(
  installedPath: string,
  now?: () => number
): Promise<PackageObservationResult> {
  try {
    const rootInfo = await lstat(installedPath);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return unsafeObservation();
    const canonicalRoot = await realpath(installedPath);
    const canonicalInfo = await stat(canonicalRoot, { bigint: true });
    if (!canonicalInfo.isDirectory()) return unsafeObservation();
    const manifestPath = join(canonicalRoot, "package.json");
    const manifestInfo = await lstat(manifestPath);
    if (
      !manifestInfo.isFile()
      || manifestInfo.isSymbolicLink()
      || manifestInfo.nlink > 1
      || manifestInfo.size > MAX_PACKAGE_MANIFEST_BYTES
    ) return unsafeObservation();
    const canonicalManifest = await realpath(manifestPath);
    if (!isContainedPackagePath(canonicalManifest, canonicalRoot)) return unsafeObservation();
    const manifestBytes = await readFile(canonicalManifest);
    if (manifestBytes.byteLength !== manifestInfo.size) return unsafeObservation();
    const manifestAfter = await lstat(canonicalManifest);
    if (!sameFileSnapshot(manifestInfo, manifestAfter)) return unsafeObservation();
    const manifest = parsePackageManifest(manifestBytes);
    if (!manifest) return unsafeObservation();
    const contentSha256 = await boundedPackageContentSha256(canonicalRoot);
    const canonicalAfter = await stat(canonicalRoot, { bigint: true });
    if (
      canonicalAfter.dev !== canonicalInfo.dev
      || canonicalAfter.ino !== canonicalInfo.ino
      || canonicalAfter.birthtimeNs !== canonicalInfo.birthtimeNs
    ) return unsafeObservation();
    const observation: ExtensionPackageObservation = {
      ...(manifest.name === undefined ? {} : { packageName: manifest.name }),
      ...(manifest.version === undefined ? {} : { packageVersion: manifest.version }),
      manifestSha256: digest(manifestBytes),
      contentSha256,
      directoryIdentityDigest: digest(
        `${canonicalInfo.dev.toString()}\0${canonicalInfo.ino.toString()}\0${canonicalInfo.birthtimeNs.toString()}`
      ),
      observedAt: timestamp(now)
    };
    return { status: "observed", observation };
  } catch (error) {
    if (error instanceof PackageInspectionLimitError) {
      return { status: "unavailable", reason: "inspection-limited" };
    }
    return nodeErrorCode(error) === "ENOENT"
      ? { status: "unavailable", reason: "install-content-missing" }
      : unsafeObservation();
  }
}

export function normalizePackageAbsolutePath(value: string): string {
  if (!isAbsolute(value)) return value;
  // Managed capability paths are emitted and consumed by the same bootstrap.
  // Exact comparison fails closed without collapsing case-sensitive Windows directories.
  return resolve(value);
}

export function isContainedPackagePath(candidate: string, root: string): boolean {
  if (!isAbsolute(candidate) || !isAbsolute(root)) return false;
  const normalizedCandidate = normalizePackageAbsolutePath(candidate);
  const normalizedRoot = normalizePackageAbsolutePath(root);
  const fromRoot = relative(normalizedRoot, normalizedCandidate);
  return fromRoot !== ""
    && fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot);
}

function boundedPackageContentSha256(root: string): Promise<string> {
  const hash = createHash("sha256");
  const budget = { files: 0, bytes: 0, startedAt: Date.now() };
  return hashDirectory(root, "", 0, budget, hash).then(() => hash.digest("hex"));
}

async function hashDirectory(
  root: string,
  relativeDirectory: string,
  depth: number,
  budget: { files: number; bytes: number; startedAt: number },
  hash: ReturnType<typeof createHash>
): Promise<void> {
  if (
    depth > MAX_PACKAGE_CONTENT_DEPTH
    || Date.now() - budget.startedAt > MAX_PACKAGE_INSPECTION_MS
  ) throw new PackageInspectionLimitError();
  const directoryPath = relativeDirectory ? join(root, relativeDirectory) : root;
  const directory = await opendir(directoryPath);
  const entries = [];
  for await (const entry of directory) entries.push(entry);
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_CONTENT_DIRECTORIES.has(entry.name)) continue;
    const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name;
    const path = join(root, relativePath);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error("Package content contains a symbolic link.");
    if (info.isDirectory()) {
      hash.update("D\0").update(relativePath.replaceAll(sep, "/")).update("\0");
      await hashDirectory(root, relativePath, depth + 1, budget, hash);
      continue;
    }
    if (!info.isFile() || info.nlink > 1) throw new Error("Package content has unsafe filesystem metadata.");
    budget.files += 1;
    budget.bytes += info.size;
    if (budget.files > MAX_PACKAGE_CONTENT_FILES || budget.bytes > MAX_PACKAGE_CONTENT_BYTES) {
      throw new PackageInspectionLimitError();
    }
    const bytes = await readFile(path);
    if (bytes.byteLength !== info.size) throw new Error("Package content changed during inspection.");
    if (Date.now() - budget.startedAt > MAX_PACKAGE_INSPECTION_MS) throw new PackageInspectionLimitError();
    const after = await lstat(path);
    if (!sameFileSnapshot(info, after)) throw new Error("Package content changed during inspection.");
    hash.update("F\0")
      .update(relativePath.replaceAll(sep, "/"))
      .update("\0")
      .update(String(bytes.byteLength))
      .update("\0")
      .update(bytes);
  }
}

function parsePackageManifest(bytes: Uint8Array): { name?: string; version?: string } | undefined {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    if (!isRecord(value)) return undefined;
    const name = boundedManifestText(value.name, 200);
    const version = boundedManifestText(value.version, 100);
    return {
      ...(name === undefined ? {} : { name }),
      ...(version === undefined ? {} : { version })
    };
  } catch {
    return undefined;
  }
}

function boundedManifestText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127) ? " " : character;
  }).join("").replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, maximum).trimEnd() : undefined;
}

function unsafeObservation(): FailedObservation {
  return { status: "unavailable", reason: "receipt-invalid" };
}

function timestamp(now: (() => number) | undefined): number {
  const value = (now ?? Date.now)();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Package observation timestamp is invalid.");
  return value;
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameFileSnapshot(left: import("node:fs").Stats, right: import("node:fs").Stats): boolean {
  return right.isFile()
    && !right.isSymbolicLink()
    && right.nlink === left.nlink
    && right.dev === left.dev
    && right.ino === left.ino
    && right.size === left.size
    && right.mtimeMs === left.mtimeMs;
}

function nodeErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
}

class PackageInspectionLimitError extends Error {}
