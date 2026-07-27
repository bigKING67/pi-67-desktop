export type SecurityLiteralCategory =
  | "bidi"
  | "zero-width"
  | "ansi"
  | "control"
  | "line-separator";

export interface SecurityLiteralAnalysis {
  raw: string;
  display: string;
  suspicious: boolean;
  suspiciousCharacterCount: number;
  categories: SecurityLiteralCategory[];
}

interface LiteralToken {
  raw: string;
  escaped?: string;
}

export function analyzeSecurityLiteral(raw: string): SecurityLiteralAnalysis {
  const characters = Array.from(raw);
  const tokens: LiteralToken[] = [];
  const categories = new Set<SecurityLiteralCategory>();
  let suspiciousCharacterCount = 0;

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === undefined) continue;

    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      tokens.push({ raw: character });
      continue;
    }
    const category = suspiciousCategory(codePoint);
    if (!category) {
      tokens.push({ raw: character });
      continue;
    }

    categories.add(category);
    suspiciousCharacterCount += 1;
    tokens.push({
      raw: character,
      escaped: escapeCodePoint(codePoint, category)
    });
  }

  const suspicious = suspiciousCharacterCount > 0;
  return {
    raw,
    display: suspicious
      ? tokens.map((token) => token.escaped ?? (token.raw === "\\" ? "\\\\" : token.raw)).join("")
      : raw,
    suspicious,
    suspiciousCharacterCount,
    categories: [...categories]
  };
}

function suspiciousCategory(codePoint: number): SecurityLiteralCategory | undefined {
  if (
    codePoint === 0x061c
    || codePoint === 0x200e
    || codePoint === 0x200f
    || (codePoint >= 0x202a && codePoint <= 0x202e)
    || (codePoint >= 0x2066 && codePoint <= 0x2069)
    || (codePoint >= 0x206a && codePoint <= 0x206f)
  ) return "bidi";
  if (
    codePoint === 0x200b
    || codePoint === 0x200c
    || codePoint === 0x200d
    || codePoint === 0x2060
    || codePoint === 0xfeff
  ) return "zero-width";
  if (codePoint === 0x001b || codePoint === 0x009b) return "ansi";
  if (codePoint === 0x0085 || codePoint === 0x2028 || codePoint === 0x2029) {
    return "line-separator";
  }
  if (codePoint <= 0x001f || (codePoint >= 0x007f && codePoint <= 0x009f)) return "control";
  return undefined;
}

function escapeCodePoint(codePoint: number, category: SecurityLiteralCategory): string {
  const hex = codePoint.toString(16).toUpperCase();
  if ((category === "ansi" || category === "control" || category === "line-separator") && codePoint <= 0x00ff) {
    return `\\x${hex.padStart(2, "0")}`;
  }
  return `\\u{${hex.padStart(4, "0")}}`;
}
