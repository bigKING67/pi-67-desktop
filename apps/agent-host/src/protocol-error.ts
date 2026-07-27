import { isRuntimeError } from "@pi67/domain";
import { ProtocolRequestError, type ProtocolError, type ProtocolErrorCode } from "@pi67/protocol";

export class HostCommandError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
    readonly recoverable = true,
    readonly details?: Record<string, string | number | boolean>
  ) {
    super(message);
    this.name = "HostCommandError";
  }
}

export function toProtocolError(error: unknown): ProtocolError {
  if (error instanceof ProtocolRequestError) {
    return {
      code: error.code,
      message: safeErrorMessage(error),
      recoverable: error.recoverable,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      ...(error.details === undefined ? {} : { details: safeDetails(error.details) })
    };
  }
  if (error instanceof HostCommandError) {
    return {
      code: error.code,
      message: safeErrorMessage(error),
      recoverable: error.recoverable,
      ...(error.details === undefined ? {} : { details: safeDetails(error.details) })
    };
  }
  if (isRuntimeError(error)) {
    return {
      code: error.code,
      message: safeErrorMessage(error),
      recoverable: error.recoverable,
      ...(error.details === undefined ? {} : { details: safeDetails(error.details) })
    };
  }
  return { code: "INTERNAL", message: safeErrorMessage(error), recoverable: true };
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown Agent Host error.";
  return redactSensitiveText(error.message).slice(0, 4_096);
}

function safeDetails(
  details: Record<string, string | number | boolean>
): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(details).map(([key, value]) => [
    key,
    typeof value !== "string"
      ? value
      : isSensitiveKey(key)
        ? "[redacted]"
        : redactSensitiveText(value).slice(0, 512)
  ]));
}

function isSensitiveKey(key: string): boolean {
  return /(?:api[-_]?key|authorization|cookie|credential|pass(?:word|phrase)?|secret|token)/iu.test(key);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"']+/giu, "Bearer [redacted]")
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9._-]{8,}/gu, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu, "[redacted]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/giu, "$1[redacted]@")
    .replace(/(["']?(?:api[-_]?key|authorization|cookie|credential|pass(?:word|phrase)?|secret|token)["']?\s*[:=]\s*["']?)[^"'\s,;}]+/giu, "$1[redacted]");
}
