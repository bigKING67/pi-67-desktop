export type ProtocolErrorCode =
  | "PROTOCOL_MISMATCH"
  | "INVALID_PAYLOAD"
  | "CONNECTION_CLOSED"
  | "REQUEST_TIMEOUT"
  | "STALE_HOST_EPOCH"
  | "STALE_SESSION_GENERATION"
  | "STALE_OPERATION"
  | "STALE_SESSION_CATALOG"
  | "DUPLICATE_REQUEST"
  | "BUSY"
  | "OPERATION_NOT_FOUND"
  | "SESSION_CHANGED_EXTERNALLY"
  | "CONFIGURATION_CHANGED_EXTERNALLY"
  | "RUNTIME_NOT_READY"
  | "RUNTIME_POISONED"
  | "MODEL_NOT_FOUND"
  | "WORKSPACE_NOT_TRUSTED"
  | "PATH_OUTSIDE_WORKSPACE"
  | "RESOURCE_LIMIT_EXCEEDED"
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
