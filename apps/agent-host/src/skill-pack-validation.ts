export function boundedVersion(value: unknown): string | undefined {
  const text = boundedText(value, 100);
  return text && /^[0-9A-Za-z.+_-]+$/u.test(text) ? text : undefined;
}

export function boundedNonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

export function boundedCommit(value: unknown): string | undefined {
  const text = boundedText(value, 64);
  return text && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(text) ? text : undefined;
}

export function boundedHttpsUrl(value: unknown): string | undefined {
  const text = boundedText(value, 500);
  if (!text) return undefined;
  try {
    return new URL(text).protocol === "https:" ? text : undefined;
  } catch {
    return undefined;
  }
}

export function boundedId(value: unknown): string | undefined {
  const text = boundedText(value, 200);
  return text && /^[A-Za-z0-9._:-]+$/u.test(text) ? text : undefined;
}

export function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  let sanitized = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    sanitized += code <= 31 || code === 127 ? " " : character;
  }
  const normalized = sanitized.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized.slice(0, maximum) : undefined;
}

export function boundedError(error: unknown): string {
  return boundedText(error instanceof Error ? error.message : String(error), 500)
    ?? "技能套件更新检查失败。";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
