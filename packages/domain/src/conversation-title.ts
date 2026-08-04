const MAX_CONVERSATION_TITLE_GRAPHEMES = 72;
const TRIVIAL_TITLE_PATTERNS = [
  /^(?:好|好的|可以|确认|继续|继续吧|继续呀|行|收到)[。！!,.，\s]*$/iu,
  /^按(?:你|您)的建议(?:来|继续|做|改)(?:吧|呀)?[。！!,.，\s]*$/iu,
  /^(?:先)?\s*(?:commit|push)(?:\s*一下(?:吧|先)?)?[。！!,.，\s]*$/iu,
  /^\/(?:plan|new|model)\s*$/iu
] as const;

export function conversationTitleCandidate(text: string, hasImage = false): string | undefined {
  const normalized = sanitizeConversationTitleText(text);
  if (!normalized) return hasImage ? "图片消息" : undefined;
  if (TRIVIAL_TITLE_PATTERNS.some((pattern) => pattern.test(normalized))) return undefined;
  const graphemes = segmentGraphemes(normalized);
  return graphemes.length <= MAX_CONVERSATION_TITLE_GRAPHEMES
    ? normalized
    : `${graphemes.slice(0, MAX_CONVERSATION_TITLE_GRAPHEMES).join("")}…`;
}

export function sanitizeConversationTitleText(text: string): string {
  let safe = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    const unsafe = codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069);
    safe += unsafe ? " " : character;
  }
  return safe.replace(/\s+/gu, " ").trim();
}

function segmentGraphemes(value: string): string[] {
  if (typeof Intl.Segmenter !== "function") return Array.from(value);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(value), ({ segment }) => segment);
}
