import { imageEngineFailure, type ImageEngineFailure } from "@pi67/domain";
import type { ProtocolErrorCode } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";

const CODES: Record<ImageEngineFailure, ProtocolErrorCode> = {
  revision_conflict: "RESOURCE_CHANGED_EXTERNALLY",
  locked: "INVALID_PAYLOAD",
  text_overflow: "INVALID_PAYLOAD",
  missing_glyph: "INVALID_PAYLOAD",
  limit_exceeded: "RESOURCE_LIMIT_EXCEEDED",
  not_found: "RESOURCE_NOT_FOUND",
  candidate_decided: "INVALID_PAYLOAD",
  decision_pending: "BUSY",
  invalid: "INVALID_PAYLOAD"
};

/**
 * Engine refusals become typed protocol errors. Every one is recoverable: the
 * person can re-read, unlock, shorten text or choose another candidate. The
 * engine's message is kept because it names objects and revisions, never paths
 * outside the project or credentials.
 */
export function imageEngineError(error: unknown): Error {
  if (error instanceof HostCommandError) return error;
  if (error instanceof Error && error.name === "AbortError") return error;
  const message = error instanceof Error ? error.message : String(error);
  const failure = imageEngineFailure(message);
  return new HostCommandError(CODES[failure], message, true, { imageReason: failure }, { cause: error });
}
