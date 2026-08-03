const COMPACT_TEXT_LIMIT = 180;
const DETAIL_TEXT_LIMIT = 3_200;
const PARSE_TEXT_LIMIT = 8_192;

export function matchesToolName(name: string, aliases: readonly string[]): boolean {
  const candidates = toolNameCandidates(name);
  return aliases.some((alias) => candidates.has(canonicalName(alias)));
}

export function normalizeToolSummary(summary: string | undefined): string | undefined {
  if (!summary) return undefined;
  const normalized = replaceControlCharacters(summary.slice(0, DETAIL_TEXT_LIMIT + 1)).trim();
  return normalized ? boundToolText(normalized, DETAIL_TEXT_LIMIT) : undefined;
}

export function parseToolSummaryFields(
  summary: string | undefined
): Record<string, unknown> | undefined {
  if (
    !summary
    || summary.length > PARSE_TEXT_LIMIT
    || !summary.trimStart().startsWith("{")
  ) return undefined;
  try {
    const value: unknown = JSON.parse(summary);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function isStructuredToolSummary(summary: string | undefined): boolean {
  const normalized = summary?.trimStart();
  return normalized?.startsWith("{") === true || normalized?.startsWith("[") === true;
}

export function readToolSummaryTextField(
  fields: Record<string, unknown> | undefined,
  keys: readonly string[]
): string | undefined {
  if (!fields) return undefined;
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) {
      return boundToolText(value.trim(), DETAIL_TEXT_LIMIT);
    }
  }
  return undefined;
}

export function readToolSummaryTextArrayField(
  fields: Record<string, unknown> | undefined,
  keys: readonly string[]
): string[] {
  if (!fields) return [];
  for (const key of keys) {
    const value = fields[key];
    if (!Array.isArray(value)) continue;
    const items = value
      .slice(0, 16)
      .flatMap((item) => typeof item === "string" && item.trim()
        ? [boundToolText(item.trim(), DETAIL_TEXT_LIMIT)]
        : []);
    if (items.length > 0) return items;
  }
  return [];
}

export function compactToolDetails<T extends { label: string; value: string }>(
  values: readonly (T | undefined)[]
): T[] {
  return values.filter((value): value is T => value !== undefined);
}

export function compactToolText(
  value: string | undefined,
  fallback: string,
  limit = COMPACT_TEXT_LIMIT
): string {
  const normalized = value?.replace(/\s+/gu, " ").trim();
  return normalized ? boundToolText(normalized, limit) : fallback;
}

export function boundToolText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  let prefix = value.slice(0, Math.max(0, limit - 1)).trimEnd();
  if (/[\uD800-\uDBFF]$/u.test(prefix)) prefix = prefix.slice(0, -1);
  return `${prefix}…`;
}

function toolNameCandidates(name: string): Set<string> {
  const boundedName = name.length > 512 ? name.slice(-512) : name;
  const tokens = boundedName.toLocaleLowerCase("en-US")
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
  const candidates = new Set<string>([canonicalName(boundedName)]);
  const last = tokens.at(-1);
  const previous = tokens.at(-2);
  if (last) candidates.add(last);
  if (previous && last) candidates.add(`${previous}${last}`);
  return candidates;
}

function canonicalName(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "");
}

function replaceControlCharacters(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const isUnsafeControl = code <= 8
      || (code >= 11 && code <= 12)
      || (code >= 14 && code <= 31)
      || code === 127;
    result += isUnsafeControl ? " " : character;
  }
  return result;
}
