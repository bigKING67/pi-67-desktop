export type RuntimeErrorCode =
  | "BUSY"
  | "CONFIGURATION_CHANGED_EXTERNALLY"
  | "INTERNAL"
  | "INVALID_PAYLOAD"
  | "MODEL_NOT_FOUND"
  | "NATIVE_BUILD_TOOLCHAIN_REQUIRED"
  | "NO_REACHABLE_PACKAGE_SOURCE"
  | "PACKAGE_INTEGRITY_MISMATCH"
  | "PACKAGE_RELOAD_REQUIRED"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "RUNTIME_NOT_READY"
  | "SESSION_CHANGED_EXTERNALLY"
  | "STALE_SESSION_CATALOG"
  | "GIT_COMMIT_MISMATCH"
  | "GIT_CONTENT_HASH_MISMATCH"
  | "TOOLCHAIN_INTEGRITY_FAILED"
  | "TOOLCHAIN_MISSING"
  | "UNSUPPORTED"
  | "WORKSPACE_NOT_TRUSTED";

export type RuntimeErrorDetails = Record<string, string | number | boolean>;

export interface RuntimeErrorOptions {
  recoverable?: boolean;
  details?: RuntimeErrorDetails;
}

const RUNTIME_ERROR_BRAND = Symbol.for("@pi67/domain/runtime-error");

export class RuntimeError extends Error {
  readonly [RUNTIME_ERROR_BRAND] = true;
  readonly recoverable: boolean;
  readonly details: RuntimeErrorDetails | undefined;

  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    options: RuntimeErrorOptions = {}
  ) {
    super(message);
    this.name = "RuntimeError";
    this.recoverable = options.recoverable ?? true;
    this.details = options.details;
  }
}

export function isRuntimeError(error: unknown): error is RuntimeError {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & {
    [RUNTIME_ERROR_BRAND]?: unknown;
    code?: unknown;
    recoverable?: unknown;
    details?: unknown;
  };
  return candidate[RUNTIME_ERROR_BRAND] === true
    && isRuntimeErrorCode(candidate.code)
    && typeof candidate.recoverable === "boolean"
    && (candidate.details === undefined || isRuntimeErrorDetails(candidate.details));
}

function isRuntimeErrorCode(value: unknown): value is RuntimeErrorCode {
  return value === "BUSY"
    || value === "CONFIGURATION_CHANGED_EXTERNALLY"
    || value === "INTERNAL"
    || value === "INVALID_PAYLOAD"
    || value === "MODEL_NOT_FOUND"
    || value === "NATIVE_BUILD_TOOLCHAIN_REQUIRED"
    || value === "NO_REACHABLE_PACKAGE_SOURCE"
    || value === "PACKAGE_INTEGRITY_MISMATCH"
    || value === "PACKAGE_RELOAD_REQUIRED"
    || value === "RESOURCE_LIMIT_EXCEEDED"
    || value === "RUNTIME_NOT_READY"
    || value === "SESSION_CHANGED_EXTERNALLY"
    || value === "STALE_SESSION_CATALOG"
    || value === "GIT_COMMIT_MISMATCH"
    || value === "GIT_CONTENT_HASH_MISMATCH"
    || value === "TOOLCHAIN_INTEGRITY_FAILED"
    || value === "TOOLCHAIN_MISSING"
    || value === "UNSUPPORTED"
    || value === "WORKSPACE_NOT_TRUSTED";
}

function isRuntimeErrorDetails(value: unknown): value is RuntimeErrorDetails {
  return typeof value === "object"
    && value !== null
    && Object.values(value).every((detail) => (
      typeof detail === "string"
      || (typeof detail === "number" && Number.isFinite(detail))
      || typeof detail === "boolean"
    ));
}
