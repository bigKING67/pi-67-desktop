export function sanitizeRuntimeText(value: string, maxLength = 4_096): string {
  return value
    .replace(/\bBearer\s+[^\s"']+/giu, "Bearer [redacted]")
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9._-]{8,}/gu, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu, "[redacted]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/giu, "$1[redacted]@")
    .replace(/(["']?(?:api[-_]?key|authorization|cookie|credential|pass(?:word|phrase)?|secret|token)["']?\s*[:=]\s*["']?)[^"'\s,;}]+/giu, "$1[redacted]")
    .slice(0, maxLength);
}
