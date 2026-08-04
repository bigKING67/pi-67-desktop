export type ProtocolErrorCode =
  | "PROTOCOL_MISMATCH"
  | "INVALID_PAYLOAD"
  | "CONNECTION_CLOSED"
  | "REQUEST_TIMEOUT"
  | "REQUEST_OUTCOME_UNKNOWN"
  | "STALE_HOST_EPOCH"
  | "STALE_SESSION_GENERATION"
  | "STALE_OPERATION"
  | "STALE_SESSION_CATALOG"
  | "DUPLICATE_REQUEST"
  | "BUSY"
  | "OPERATION_NOT_FOUND"
  | "SESSION_CHANGED_EXTERNALLY"
  | "CONFIGURATION_CHANGED_EXTERNALLY"
  | "RESOURCE_CHANGED_EXTERNALLY"
  | "RUNTIME_NOT_READY"
  | "RUNTIME_POISONED"
  | "MODEL_NOT_FOUND"
  | "NATIVE_BUILD_TOOLCHAIN_REQUIRED"
  | "NO_REACHABLE_PACKAGE_SOURCE"
  | "PACKAGE_INTEGRITY_MISMATCH"
  | "PACKAGE_RELOAD_REQUIRED"
  | "GIT_COMMIT_MISMATCH"
  | "GIT_CONTENT_HASH_MISMATCH"
  | "TOOLCHAIN_INTEGRITY_FAILED"
  | "TOOLCHAIN_MISSING"
  | "WORKSPACE_NOT_TRUSTED"
  | "PATH_OUTSIDE_WORKSPACE"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "RESOURCE_NOT_FOUND"
  | "UNSUPPORTED"
  | "INTERNAL";

export interface ProtocolError {
  code: ProtocolErrorCode;
  message: string;
  recoverable: boolean;
  retryAfterMs?: number;
  details?: Record<string, string | number | boolean>;
}

export class ProtocolRequestError extends Error {
  readonly code: ProtocolErrorCode;
  readonly recoverable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly details: Record<string, string | number | boolean> | undefined;

  constructor(error: ProtocolError) {
    super(error.message);
    this.name = "ProtocolRequestError";
    this.code = error.code;
    this.recoverable = error.recoverable;
    this.retryAfterMs = error.retryAfterMs;
    this.details = error.details;
  }
}
