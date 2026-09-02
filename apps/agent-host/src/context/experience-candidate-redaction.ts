import { HostCommandError } from "../protocol-error.js";

export function redactAndRequireExperience(value: string, maximum: number, field: string): string {
  const redacted = redactExperienceText(value).trim();
  if (!redacted) {
    throw new HostCommandError("INVALID_PAYLOAD", `Experience ${field} is empty after redaction.`, false);
  }
  return redacted.length <= maximum ? redacted : `${redacted.slice(0, maximum - 1)}…`;
}

function redactExperienceText(value: string): string {
  return value
    .replace(/\b(?:api[_ -]?key|cookie|bearer|authorization|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key|\.env)\b/giu, "credential")
    .replace(/(?:[A-Za-z]:\\(?:Users|Documents|Desktop)\\|\/(?:Users|home|private|var\/folders)\/)[^\s)\]}>,;]+/gu, "[REDACTED_LOCAL_PATH]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED_EMAIL]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, "[REDACTED_ADDRESS]")
    .replace(/\b1[3-9]\d{9}\b/gu, "[REDACTED_PHONE]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/gu, "[REDACTED_CREDENTIAL]");
}
