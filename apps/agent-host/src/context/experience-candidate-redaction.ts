import { HostCommandError } from "../protocol-error.js";

const REDACTED_CREDENTIAL = "[REDACTED_CREDENTIAL]";
const CREDENTIAL_LABEL = "(?:[a-z0-9]+[_-])*(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key|password|passwd|session[_ -]?token|auth[_ -]?token)";
const AUTHORIZATION_HEADER = /\b(?:proxy-authorization|authorization)\s*:\s*(?:(?:bearer|basic|token)\s+)?[^\s,;]+/giu;
const COOKIE_HEADER = /\b(?:set-cookie|cookie)\s*:\s*[^\r\n]+/giu;
const BEARER_VALUE = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{3,}/giu;
const CREDENTIAL_ASSIGNMENT = new RegExp(
  `(?:["']?${CREDENTIAL_LABEL}["']?)\\s*(?:=|:|=>)\\s*(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s,;)\\]}]+)`,
  "giu",
);
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu;
const PROVIDER_TOKEN = /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[a-z]-[A-Za-z0-9-]{16,}|AIza[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|ark-[A-Za-z0-9-]{24,})\b/gu;
const JWT = /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?\b/gu;
const CREDENTIAL_WORD = new RegExp(`\\b(?:${CREDENTIAL_LABEL}|cookie|bearer|authorization)\\b`, "giu");
const RESIDUAL_ASSIGNMENT = /\bcredential\b\s*(?:=|:|=>)\s*(?!\[REDACTED_CREDENTIAL\])[^\s,;)\]}]+/iu;
const LONG_TOKEN = /[A-Za-z0-9+/_=-]{40,}/gu;

export function redactAndRequireExperience(value: string, maximum: number, field: string): string {
  const redacted = redactExperienceText(value).trim();
  if (!redacted) {
    throw new HostCommandError("INVALID_PAYLOAD", `Experience ${field} is empty after redaction.`, false);
  }
  if (containsCredentialLikeValue(redacted)) {
    throw new HostCommandError(
      "INVALID_PAYLOAD",
      `Experience ${field} still contains a credential-like value after redaction.`,
      false,
    );
  }
  return redacted.length <= maximum ? redacted : `${redacted.slice(0, maximum - 1)}…`;
}

function redactExperienceText(value: string): string {
  return value
    .replace(PRIVATE_KEY_BLOCK, REDACTED_CREDENTIAL)
    .replace(AUTHORIZATION_HEADER, REDACTED_CREDENTIAL)
    .replace(COOKIE_HEADER, REDACTED_CREDENTIAL)
    .replace(CREDENTIAL_ASSIGNMENT, REDACTED_CREDENTIAL)
    .replace(BEARER_VALUE, REDACTED_CREDENTIAL)
    .replace(PROVIDER_TOKEN, REDACTED_CREDENTIAL)
    .replace(JWT, REDACTED_CREDENTIAL)
    .replace(/(?:[A-Za-z]:\\(?:Users|Documents|Desktop)\\|\/(?:Users|home|private|var\/folders)\/)[^\s)\]}>,;]+/gu, "[REDACTED_LOCAL_PATH]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED_EMAIL]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, "[REDACTED_ADDRESS]")
    .replace(/\b1[3-9]\d{9}\b/gu, "[REDACTED_PHONE]")
    .replace(/\.env\b/giu, "credential file")
    .replace(CREDENTIAL_WORD, "credential");
}

function containsCredentialLikeValue(value: string): boolean {
  if (RESIDUAL_ASSIGNMENT.test(value)) return true;
  for (const match of value.matchAll(LONG_TOKEN)) {
    const candidate = match[0];
    const prefix = value.slice(Math.max(0, (match.index ?? 0) - 24), match.index).trimEnd();
    if (/^[a-f0-9]{64}$/iu.test(candidate) && /(?:sha-?256|content hash|artifact hash)\s*[:=]?$/iu.test(prefix)) {
      continue;
    }
    const characterClasses = [/[a-z]/u, /[A-Z]/u, /\d/u, /[+/_=-]/u]
      .filter((pattern) => pattern.test(candidate)).length;
    if (characterClasses >= 2) return true;
  }
  return false;
}
