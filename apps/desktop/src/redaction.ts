const assignmentSecret = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)\b(\s*[=:]\s*)["']?[^\s,"']+/giu;
const jsonSecret = /"(apiKey|accessToken|refreshToken|token|password|secret)"\s*:\s*"[^"]*"/giu;
const bearerSecret = /(?:sk-|ghp_|Bearer\s+)[A-Za-z0-9._-]+/gu;
const jwtSecret = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu;

export function redact(value: string): string {
  return value
    .replace(jsonSecret, '"$1":"[redacted]"')
    .replace(assignmentSecret, "$1$2[redacted]")
    .replace(bearerSecret, "[redacted]")
    .replace(jwtSecret, "[redacted]");
}
