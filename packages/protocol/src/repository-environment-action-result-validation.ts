import type {
  AppOwnedWorktreeRecoveryResult,
  RepositorySubmoduleInitializationResult
} from "./repository-environment-contract.js";

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]{0,39})$/u;

export function isRepositorySubmoduleInitializationResult(
  value: unknown
): value is RepositorySubmoduleInitializationResult {
  if (!isRecord(value)) return false;
  if (value.status === "rejected") {
    return hasExactKeys(value, ["status", "error"])
      && ["invalid-request", "workspace-unavailable", "repository-stale", "git-failed", "internal"]
        .includes(value.error as string);
  }
  return (value.status === "initialized" || value.status === "incomplete")
    && hasExactKeys(value, ["status", "submodules"])
    && isSubmoduleObservation(value.submodules);
}

export function isAppOwnedWorktreeRecoveryResult(
  value: unknown
): value is AppOwnedWorktreeRecoveryResult {
  if (!isRecord(value)) return false;
  if (value.status === "rejected") {
    return hasExactKeys(value, ["status", "error", "recoverable"])
      && [
        "invalid-request", "not-app-owned", "identity-changed", "not-recoverable", "git-failed", "internal"
      ].includes(value.error as string)
      && typeof value.recoverable === "boolean";
  }
  return value.status === "recovered"
    && hasExactKeys(value, ["status", "workspace"])
    && isWorkspaceDescriptor(value.workspace);
}

function isSubmoduleObservation(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, [
    "status", "total", "uninitialized", "divergent", "conflicted", "networkActionRequired"
  ])) return false;
  if (!["not-configured", "complete", "incomplete", "conflicted"].includes(value.status as string)) return false;
  if (![value.total, value.uninitialized, value.divergent, value.conflicted].every((count) => (
    Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= 10_000
  ))) return false;
  if (Number(value.uninitialized) + Number(value.divergent) + Number(value.conflicted) > Number(value.total)) {
    return false;
  }
  if (typeof value.networkActionRequired !== "boolean") return false;
  return !value.networkActionRequired || (
    value.status === "incomplete"
    && Number(value.uninitialized) > 0
    && Number(value.divergent) === 0
    && Number(value.conflicted) === 0
  );
}

function isWorkspaceDescriptor(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, [
    "id", "displayName", "identity", "trust", "trustProvenance", "availability"
  ], ["lastVerifiedAt"])) return false;
  return isId(value.id)
    && typeof value.displayName === "string"
    && value.displayName.length >= 1
    && value.displayName.length <= 1_024
    && isWorkspaceIdentity(value.identity)
    && (value.lastVerifiedAt === undefined || isTimestamp(value.lastVerifiedAt))
    && ["unknown", "trusted", "untrusted"].includes(value.trust as string)
    && ["native-picker", "user-confirmed", "restored", "identity-changed", "indirect"]
      .includes(value.trustProvenance as string)
    && ["available", "missing", "identity-changed", "needs-confirmation", "unavailable"]
      .includes(value.availability as string);
}

function isWorkspaceIdentity(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["canonicalPath", "assurance"], [
    "device", "inode", "birthtimeNs"
  ])) return false;
  if (
    typeof value.canonicalPath !== "string"
    || value.canonicalPath.length < 1
    || value.canonicalPath.length > 32_768
    || value.canonicalPath.includes("\0")
    || !isAbsolutePath(value.canonicalPath)
  ) return false;
  if (value.device !== undefined && !isDecimal(value.device)) return false;
  if (value.inode !== undefined && !isDecimal(value.inode)) return false;
  if (value.birthtimeNs !== undefined && !isDecimal(value.birthtimeNs)) return false;
  if (value.assurance === "path-only") return true;
  return value.assurance === "filesystem" && value.device !== undefined && value.inode !== undefined;
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || /^\\\\[^\\]+\\[^\\]+/u.test(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isDecimal(value: unknown): boolean {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

function isTimestamp(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const keys = Object.keys(value);
  if (!required.every((key) => Object.hasOwn(value, key))) return false;
  const allowed = new Set([...required, ...optional]);
  return keys.every((key) => allowed.has(key));
}
