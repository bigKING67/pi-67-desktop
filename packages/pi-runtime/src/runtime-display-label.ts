const PRIVATE_USE_OR_REPLACEMENT = /[\uE000-\uF8FF\uFFFD]/u;
const LATIN_MOJIBAKE = /(?:\u00C2|\u00C3|\u00E2\u0080|\u00F0\u009F)/u;
const COMMON_MOJIBAKE_SEQUENCE = /(?:\u951F\u65A4\u62F7|\u907D\u6C1F)/u;
const SUSPICIOUS_MOJIBAKE_CHARACTERS = /[\u93C8\u9428\u9286\u934B\u93C4\u947A\u934A\u6EC7\u93E1]/gu;

const TOKEN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ai: "AI",
  api: "API",
  codex: "Codex",
  deepseek: "DeepSeek",
  gpt: "GPT",
  qwen: "Qwen",
  vl: "VL",
  xtalpi: "XtalPi"
});

export function runtimeDisplayLabel(name: string | undefined, identity: string): string {
  const candidate = name?.trim();
  if (candidate && !isLikelyMojibake(candidate)) return candidate;
  return identityDisplayLabel(identity);
}

export function isLikelyMojibake(value: string): boolean {
  return hasUnexpectedControlCharacter(value)
    || PRIVATE_USE_OR_REPLACEMENT.test(value)
    || LATIN_MOJIBAKE.test(value)
    || COMMON_MOJIBAKE_SEQUENCE.test(value)
    || [...value.matchAll(SUSPICIOUS_MOJIBAKE_CHARACTERS)].length >= 2;
}

function hasUnexpectedControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      (codePoint >= 0 && codePoint <= 8)
      || codePoint === 11
      || codePoint === 12
      || (codePoint >= 14 && codePoint <= 31)
      || codePoint === 127
    ) return true;
  }
  return false;
}

function identityDisplayLabel(identity: string): string {
  const tokens = identity
    .trim()
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((token) => TOKEN_LABELS[token.toLowerCase()] ?? formatIdentityToken(token));
  return tokens.join(" ") || identity;
}

function formatIdentityToken(token: string): string {
  if (/^v\d/iu.test(token)) return `V${token.slice(1)}`;
  if (/^\d+(?:\.\d+)*$/u.test(token)) return token;
  return `${token.charAt(0).toUpperCase()}${token.slice(1)}`;
}
