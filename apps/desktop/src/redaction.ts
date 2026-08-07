const assignmentSecret = /(?<![?&])\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)\b(\s*[=:]\s*)["']?[^\s,"']+/giu;
const jsonSecret = /"(apiKey|accessToken|refreshToken|token|password|secret)"\s*:\s*"[^"]*"/giu;
const authorizationSecret = /\b(Authorization)(\s*:\s*)[^\r\n]+/giu;
const cookieSecret = /\b(Cookie|Set-Cookie)(\s*:\s*)[^\r\n]+/giu;
const bearerSecret = /(?:sk-|ghp_|Bearer\s+)[A-Za-z0-9._-]+/giu;
const jwtSecret = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu;
const querySecret = /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)=)[^&#\s]*/giu;

export function redact(value: string): string {
  return value
    .replace(jsonSecret, '"$1":"[redacted]"')
    .replace(assignmentSecret, "$1$2[redacted]")
    .replace(authorizationSecret, "$1$2[redacted]")
    .replace(cookieSecret, "$1$2[redacted]")
    .replace(querySecret, "$1[redacted]")
    .replace(bearerSecret, "[redacted]")
    .replace(jwtSecret, "[redacted]");
}
